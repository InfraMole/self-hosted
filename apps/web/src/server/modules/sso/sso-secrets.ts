// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { getDb, systemDb, type Db } from "@/server/db";
import {
  needsRotation,
  openSecret,
  sealSecret,
  SecretConfigError,
  type Keyring,
} from "@/server/crypto";
import {
  credentialsKeyring,
  integrationsEnabled,
} from "@/server/modules/integrations/integrations";
import { openLdapSettings, sealLdapSettings } from "./ldap";

/**
 * Secrets inside the SSO plugin's provider rows (ADR-053): the OIDC client
 * secret and the SAML SP private key live in the JSON columns `oidcConfig` /
 * `samlConfig`, which the plugin reads on every sign-in. They are stored
 * sealed (AES-256-GCM with CREDENTIALS_ENCRYPTION_KEY, AAD
 * `sso:<providerId>:<path>`) as `sealed:v1:<keyVersion>:<iv>:<ciphertext>`;
 * the rest of the JSON stays readable. A Prisma query extension seals on
 * write and opens on read, so the plugin and the SSO module see plain values
 * and nothing else changes. Rows written before this are opened as they are
 * and sealed by the maintenance job.
 */
const SECRET_PATHS = {
  oidcConfig: [["clientSecret"]],
  samlConfig: [["privateKey"], ["spMetadata", "privateKey"]],
} as const;

export type SsoConfigColumn = keyof typeof SECRET_PATHS;
const COLUMNS = Object.keys(SECRET_PATHS) as SsoConfigColumn[];

const SEALED = /^sealed:v1:(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

const aad = (providerId: string, path: string) => `sso:${providerId}:${path}`;

/** Applies `fn` to each non-empty secret string of a config JSON. */
function mapSecrets(
  column: SsoConfigColumn,
  json: string,
  fn: (value: string, path: string) => string,
): string {
  const doc = JSON.parse(json) as Record<string, unknown>;
  let changed = false;
  for (const path of SECRET_PATHS[column]) {
    let parent: unknown = doc;
    for (const key of path.slice(0, -1))
      parent =
        parent && typeof parent === "object" ? (parent as Record<string, unknown>)[key] : null;
    if (!parent || typeof parent !== "object") continue;
    const holder = parent as Record<string, unknown>;
    const key = path[path.length - 1]!;
    const value = holder[key];
    if (typeof value !== "string" || !value) continue;
    const next = fn(value, path.join("."));
    if (next !== value) {
      holder[key] = next;
      changed = true;
    }
  }
  return changed ? JSON.stringify(doc) : json;
}

/** Seals plain secrets (and re-seals ones from an older key). */
export function sealConfig(
  column: SsoConfigColumn,
  json: string,
  providerId: string,
  keyring: Keyring,
): string {
  return mapSecrets(column, json, (value, path) => {
    const m = SEALED.exec(value);
    if (m && !needsRotation({ keyVersion: Number(m[1]) }, keyring)) return value;
    const plain = m ? openSealed(m, providerId, path, keyring) : value;
    const s = sealSecret(plain, aad(providerId, path), keyring);
    return `sealed:v1:${s.keyVersion}:${s.iv}:${s.ciphertext}`;
  });
}

function openSealed(m: RegExpExecArray, providerId: string, path: string, keyring: Keyring) {
  return openSecret(
    { keyVersion: Number(m[1]), iv: m[2]!, ciphertext: m[3]! },
    aad(providerId, path),
    keyring,
  );
}

/** Opens sealed secrets; plain ones (rows from before ADR-053) pass through. */
export function openConfig(
  column: SsoConfigColumn,
  json: string,
  providerId: string,
  keyring: Keyring | null,
): string {
  return mapSecrets(column, json, (value, path) => {
    const m = SEALED.exec(value);
    if (!m) return value;
    if (!keyring) throw new SecretConfigError();
    return openSealed(m, providerId, path, keyring);
  });
}

/** True when a config still holds a plain secret or one sealed with an older key. */
export function configNeedsSealing(
  column: SsoConfigColumn,
  json: string,
  keyring: Keyring,
): boolean {
  let needed = false;
  mapSecrets(column, json, (value) => {
    const m = SEALED.exec(value);
    if (!m || needsRotation({ keyVersion: Number(m[1]) }, keyring)) needed = true;
    return value;
  });
  return needed;
}

export function ssoKeyring(): Keyring | null {
  return integrationsEnabled() ? credentialsKeyring() : null;
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function openRow(row: Row, keyring: Keyring | null): Row {
  const providerId = row.providerId;
  for (const column of COLUMNS) {
    const json = row[column];
    if (typeof json !== "string" || !json) continue;
    if (typeof providerId !== "string") throw new Error("ssoProvider: providerId is needed");
    row[column] = openConfig(column, json, providerId, keyring);
  }
  return row;
}

function sealData(data: unknown, providerId: unknown): void {
  if (!isRow(data)) return;
  for (const column of COLUMNS) {
    const json = data[column];
    if (typeof json !== "string" || !json) continue;
    if (typeof providerId !== "string") throw new Error("ssoProvider: write by providerId");
    const keyring = ssoKeyring();
    if (!keyring) throw new SecretConfigError();
    data[column] = sealConfig(column, json, providerId, keyring);
  }
}

/**
 * The database client for `ssoProvider` rows: the same client as getDb(),
 * extended to seal and open the secrets. The SSO plugin's adapter and the
 * SSO module both use it; nothing else touches those rows.
 */
export function withSsoSecrets(db: Db) {
  return db.$extends({
    name: "sso-secrets",
    query: {
      ssoProvider: {
        async $allOperations({ operation, args, query }) {
          const a = args as Row;
          const where = isRow(a.where) ? a.where : {};
          if (operation === "create") sealData(a.data, isRow(a.data) ? a.data.providerId : null);
          if (operation === "update" || operation === "updateMany")
            sealData(a.data, where.providerId);
          if (operation === "upsert") {
            sealData(a.create, isRow(a.create) ? a.create.providerId : null);
            sealData(a.update, where.providerId);
          }
          if (operation === "createMany") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            for (const row of rows) sealData(row, isRow(row) ? row.providerId : null);
          }
          // Opening needs providerId (the AAD): select it when a config is selected.
          const select = isRow(a.select) ? a.select : null;
          const added =
            select && COLUMNS.some((c) => select[c]) && !select.providerId
              ? (select.providerId = true)
              : false;
          const result = (await query(args)) as unknown;
          const keyring = ssoKeyring();
          const open = (row: unknown) => {
            if (!isRow(row)) return row;
            openRow(row, keyring);
            if (added) delete row.providerId;
            return row;
          };
          return Array.isArray(result) ? result.map(open) : open(result);
        },
      },
    },
  });
}

const globalForSso = globalThis as unknown as {
  __ssoDb?: ReturnType<typeof withSsoSecrets>;
  __ssoBase?: Db;
};

/** getDb() with sealed SSO secrets (one extended client per base client). */
export function ssoDb() {
  const base = getDb();
  if (globalForSso.__ssoBase !== base || !globalForSso.__ssoDb) {
    globalForSso.__ssoDb = withSsoSecrets(base);
    globalForSso.__ssoBase = base;
  }
  return globalForSso.__ssoDb;
}

/**
 * Maintenance job: seals secrets stored before ADR-053 and re-seals those of
 * an older key version — provider rows and LDAP settings — so a rotated key
 * (DEPLOYMENT §7) reaches every SSO secret. Without CREDENTIALS_ENCRYPTION_KEY
 * it does nothing.
 */
export async function sealStoredSsoSecrets(): Promise<{ sealed: number }> {
  const keyring = ssoKeyring();
  if (!keyring) return { sealed: 0 };
  const ldapSealed = await resealLdapSettings(keyring);
  // Raw rows (the base client): the extension would hide what is plain.
  const rows = await getDb().ssoProvider.findMany({
    select: { providerId: true, oidcConfig: true, samlConfig: true },
  });
  let sealed = 0;
  for (const row of rows) {
    const data: Partial<Record<SsoConfigColumn, string>> = {};
    for (const column of COLUMNS) {
      const json = row[column];
      if (json && configNeedsSealing(column, json, keyring))
        data[column] = sealConfig(column, json, row.providerId, keyring);
    }
    if (!Object.keys(data).length) continue;
    await getDb().ssoProvider.update({ where: { providerId: row.providerId }, data });
    sealed++;
  }
  return { sealed: sealed + ldapSealed };
}

async function resealLdapSettings(keyring: Keyring): Promise<number> {
  const db = systemDb("SSO: re-seal LDAP settings with the current key");
  const rows = await db.workspaceSso.findMany({
    where: { ldapKeyVersion: { not: null }, NOT: { ldapKeyVersion: keyring.current.version } },
    select: {
      id: true,
      workspaceId: true,
      providerId: true,
      ldapCiphertext: true,
      ldapIv: true,
      ldapKeyVersion: true,
    },
  });
  let sealed = 0;
  for (const row of rows) {
    if (!row.ldapCiphertext || !row.ldapIv || row.ldapKeyVersion === null) continue;
    try {
      const settings = openLdapSettings(
        { ciphertext: row.ldapCiphertext, iv: row.ldapIv, keyVersion: row.ldapKeyVersion },
        row.workspaceId,
        row.providerId,
      );
      const next = sealLdapSettings(settings, row.workspaceId, row.providerId);
      await db.workspaceSso.update({
        where: { id: row.id },
        data: { ldapCiphertext: next.ciphertext, ldapIv: next.iv, ldapKeyVersion: next.keyVersion },
      });
      sealed++;
    } catch {
      // Previous key already removed: the owner enters the password again.
      console.warn(`[sso] LDAP settings of connection ${row.id} could not be re-sealed`);
    }
  }
  return sealed;
}
