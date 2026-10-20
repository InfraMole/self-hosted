// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { lookup } from "node:dns/promises";
import { Client, Filter, InvalidCredentialsError, NoSuchObjectError } from "ldapts";
import { z } from "zod";
import { openSecret, sealSecret, type SealedSecret } from "@/server/crypto";
import { getEnv } from "@/server/env";
import { isPublicAddress } from "@/server/safe-fetch";
import { credentialsKeyring } from "@/server/modules/integrations/integrations";

/**
 * LDAP / Active Directory sign-in (M33, ADR-048). The connection's settings
 * (with the service account's password) are sealed with
 * CREDENTIALS_ENCRYPTION_KEY, bound to the connection row. A sign-in:
 *   1. binds as the service account and finds exactly one entry with the
 *      user filter (the email escaped, RFC 4515);
 *   2. reads its groups (memberOf, or groups whose member is that entry);
 *   3. binds as that entry with the password typed — the directory checks it.
 * InfraMole never stores or logs the password typed, and only reads.
 */

export class LdapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LdapError";
  }
}

const DN = z
  .string()
  .trim()
  .min(3)
  .max(1024)
  .regex(/^[^=,\s]+=[^,]+(,\s*[^=,\s]+=[^,]+)*$/, "A distinguished name like dc=uni,dc=example");

export const ldapSettingsSchema = z.object({
  /** ldaps://host[:port], or ldap:// only for a server in SSO_TRUSTED_ORIGINS. */
  url: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^ldaps?:\/\/[^/\s?#]+$/, "A server like ldaps://dc01.uni.example:636"),
  bindDn: DN,
  /** Empty on update = keep the stored password. */
  bindPassword: z.string().max(1024).default(""),
  baseDn: DN,
  userFilter: z
    .string()
    .trim()
    .max(1024)
    .default("(mail={email})")
    .refine((f) => f.startsWith("(") && f.includes("{email}"), "A filter containing {email}"),
});
export type LdapSettings = z.infer<typeof ldapSettingsSchema>;

/** What the Settings form may show back (everything but the password). */
export type LdapSettingsView = Omit<LdapSettings, "bindPassword">;

const aad = (workspaceId: string, providerId: string) => `sso-ldap:${workspaceId}:${providerId}`;

export function sealLdapSettings(
  settings: LdapSettings,
  workspaceId: string,
  providerId: string,
): SealedSecret {
  return sealSecret(JSON.stringify(settings), aad(workspaceId, providerId), credentialsKeyring());
}

export function openLdapSettings(
  sealed: SealedSecret,
  workspaceId: string,
  providerId: string,
): LdapSettings {
  return ldapSettingsSchema.parse(
    JSON.parse(openSecret(sealed, aad(workspaceId, providerId), credentialsKeyring())),
  );
}

function trustedServer(url: string): boolean {
  return (getEnv().SSO_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase().replace(/\/+$/, ""))
    .includes(url);
}

/**
 * The client for a server: ldaps:// on public addresses (connected by the
 * address checked, the certificate still checked against the host name), or
 * any server the operator trusts (SSO_TRUSTED_ORIGINS).
 */
async function clientFor(url: string): Promise<Client> {
  const timeouts = { timeout: 10_000, connectTimeout: 10_000 };
  if (trustedServer(url)) return new Client({ url, ...timeouts });
  if (!url.startsWith("ldaps://"))
    throw new LdapError(
      "Use ldaps:// — plain ldap:// is only allowed for a server in SSO_TRUSTED_ORIGINS.",
    );
  const { hostname, port } = new URL(url.replace(/^ldaps:/, "https:"));
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new LdapError(`Cannot resolve ${host}.`);
  if (!addresses.every((a) => isPublicAddress(a.address)))
    throw new LdapError(
      `${host} is not a public address. For a directory on your network, the server administrator adds ${url} to SSO_TRUSTED_ORIGINS.`,
    );
  const address = addresses[0]!.address;
  const pinned = address.includes(":") ? `[${address}]` : address;
  return new Client({
    url: `ldaps://${pinned}:${port || "636"}`,
    tlsOptions: { servername: host },
    ...timeouts,
  });
}

function values(entry: Record<string, unknown>, attribute: string): string[] {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
  const v = key ? entry[key] : undefined;
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return list.map((x) => (Buffer.isBuffer(x) ? x.toString("utf8") : String(x)));
}

const describe = (error: unknown) =>
  error instanceof InvalidCredentialsError
    ? "the service account's DN or password was refused"
    : error instanceof NoSuchObjectError
      ? "the search base DN does not exist, or the service account cannot read it"
      : error instanceof Error
        ? error.message
        : "unknown error";

/** Save-time check: the service account binds and can search the base DN. */
export async function testLdapSettings(settings: LdapSettings): Promise<void> {
  const client = await clientFor(settings.url);
  try {
    await client.bind(settings.bindDn, settings.bindPassword);
    await client.search(settings.baseDn, { scope: "base", attributes: ["dn"] });
  } catch (error) {
    if (error instanceof LdapError) throw error;
    throw new LdapError(`Could not use the directory: ${describe(error)}.`);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

export interface LdapIdentity {
  dn: string;
  name: string;
  groups: string[];
}

/**
 * Checks an email + password against the directory. null = wrong email or
 * password (indistinguishable for the caller); LdapError = the directory
 * could not be used.
 */
export async function ldapAuthenticate(
  settings: LdapSettings,
  groupsAttribute: string,
  email: string,
  password: string,
): Promise<LdapIdentity | null> {
  // An empty password is an anonymous bind, which many servers accept.
  if (!password) return null;
  const client = await clientFor(settings.url);
  try {
    try {
      await client.bind(settings.bindDn, settings.bindPassword);
    } catch (error) {
      throw new LdapError(`Directory service account: ${describe(error)}.`);
    }
    const filter = settings.userFilter.replaceAll("{email}", Filter.escape(email));
    const { searchEntries } = await client.search(settings.baseDn, {
      scope: "sub",
      filter,
      attributes: ["cn", "displayName", groupsAttribute],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) return null;
    const entry = searchEntries[0]!;
    const groups = values(entry, groupsAttribute);
    // Directories without memberOf (OpenLDAP without the overlay): look the
    // groups up by member.
    if (!groups.length) {
      const dn = Filter.escape(entry.dn);
      const found = await client.search(settings.baseDn, {
        scope: "sub",
        filter: `(|(member=${dn})(uniqueMember=${dn}))`,
        attributes: ["cn"],
        sizeLimit: 500,
      });
      for (const g of found.searchEntries) groups.push(g.dn, ...values(g, "cn"));
    }
    try {
      await client.bind(entry.dn, password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) return null;
      throw error;
    }
    const name = values(entry, "displayName")[0] ?? values(entry, "cn")[0] ?? email;
    return { dn: entry.dn, name, groups };
  } catch (error) {
    if (error instanceof LdapError) throw error;
    throw new LdapError(`Could not use the directory: ${describe(error)}.`);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}
