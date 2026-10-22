// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { lookup, resolveTxt } from "node:dns/promises";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  SSO_ROLES,
  emailDomain,
  groupsFrom,
  parseGroupRules,
  roleFor,
  type GroupRole,
  type SsoRole,
} from "@/lib/sso-roles";
import { editionHas } from "@/lib/billing-plans";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { getDb, systemDb, tenantDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { isPublicAddress, safeFetch } from "@/server/safe-fetch";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import * as samlify from "samlify";
import { integrationsEnabled } from "@/server/modules/integrations/integrations";
import {
  LdapError,
  ldapAuthenticate,
  ldapSettingsSchema,
  openLdapSettings,
  sealLdapSettings,
  testLdapSettings,
  type LdapSettings,
  type LdapSettingsView,
} from "./ldap";
import { createSpCertificate } from "./sp-certificate";
import { ssoDb } from "./sso-secrets";

/**
 * Enterprise single sign-on (M33, ADR-048). A workspace connects one identity
 * provider per email domain — OIDC or SAML through Better Auth's SSO plugin
 * (LDAP: ./ldap.ts) — and maps directory groups to workspace roles. The
 * plugin runs the protocols; this module owns who may configure what, which
 * domain is trusted, and who gets in with which role.
 *
 * Safety rules:
 *  - a connection signs people in only for a domain proven by DNS (or one the
 *    operator trusts: SSO_TRUSTED_DOMAINS), and only for emails of that domain;
 *  - one verified connection per domain across the installation;
 *  - OWNERs manage connections; directories never grant OWNER, and existing
 *    owners are never demoted or removed by a sign-in;
 *  - every endpoint the server calls is public (SSRF) unless the operator
 *    trusts its origin (SSO_TRUSTED_ORIGINS).
 */

export class SsoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoError";
  }
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const PUBLIC_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "aol.com",
]);

const common = {
  name: z.string().trim().min(1, "Give the connection a name").max(80),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN, "An email domain like uni.example")
    .refine((d) => !PUBLIC_MAIL.has(d), "Public email providers cannot be connected"),
  groupsClaim: z.string().trim().min(1).max(256).default("groups"),
  groupRules: z.string().max(20_000).default(""),
  defaultRole: z
    .union([z.enum(SSO_ROLES), z.literal("")])
    .default("")
    .transform((v) => (v === "" ? null : v)),
  enforced: z.coerce.boolean().default(false),
};

const httpsOrTrusted = z
  .string()
  .trim()
  .url("A URL like https://login.example.com/realms/uni")
  .refine(
    (v) => v.startsWith("https://") || trustedOrigin(v),
    "https:// (http only for an origin in SSO_TRUSTED_ORIGINS)",
  )
  .transform((v) => v.replace(/\/+$/, ""));

export const oidcInputSchema = z.object({
  protocol: z.literal("OIDC"),
  ...common,
  issuer: httpsOrTrusted,
  clientId: z.string().trim().min(1).max(512),
  /** Empty on update = keep the stored secret. */
  clientSecret: z.string().trim().max(2048).default(""),
  /** Extra scopes besides openid email profile (e.g. "groups" for Okta). */
  extraScopes: z
    .string()
    .trim()
    .max(200)
    .regex(/^[\w:./-]*( [\w:./-]+)*$/, "Space-separated scopes")
    .default(""),
});

export const samlInputSchema = z.object({
  protocol: z.literal("SAML"),
  ...common,
  /** IdP metadata XML, pasted (the server never fetches it). Empty on update = keep. */
  idpMetadata: z
    .string()
    .trim()
    .max(200_000)
    .refine(
      (v) => v === "" || /<(\w+:)?EntityDescriptor[\s>]/.test(v),
      "Paste the IdP metadata XML",
    )
    .default(""),
});

export const ldapInputSchema = z.object({
  protocol: z.literal("LDAP"),
  ...common,
  ...ldapSettingsSchema.shape,
});

export const ssoInputSchema = z.discriminatedUnion("protocol", [
  oidcInputSchema,
  samlInputSchema,
  ldapInputSchema,
]);
export type SsoInput = z.input<typeof ssoInputSchema>;

// ───────────────────────── trust helpers ─────────────────────────

/** Enterprise SSO is an edition capability (every edition for now, ADR-048). */
export function ssoAvailable(): boolean {
  return editionHas(getEnv().EDITION, "enterpriseSso");
}

function assertSsoAvailable() {
  if (!ssoAvailable()) throw new SsoError("Single sign-on is not part of this edition.");
  // Client secrets, SP keys and LDAP passwords are stored sealed (ADR-053).
  if (!integrationsEnabled())
    throw new SsoError(
      "Single sign-on stores its secrets encrypted: the server administrator sets CREDENTIALS_ENCRYPTION_KEY first.",
    );
}

function trustedOrigins(): string[] {
  return (getEnv().SSO_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function trustedOrigin(url: string): boolean {
  try {
    return trustedOrigins().includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Domains the operator vouches for: no DNS proof needed. */
export function operatorTrustsDomain(domain: string): boolean {
  return (getEnv().SSO_TRUSTED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .includes(domain);
}

/** An endpoint the server will call: https on public addresses, or a trusted origin. */
async function assertCallable(name: string, url: string | undefined): Promise<void> {
  if (!url) throw new SsoError(`The provider did not publish its ${name}.`);
  if (trustedOrigin(url)) return;
  const u = new URL(url);
  if (u.protocol !== "https:") throw new SsoError(`The ${name} must use https:// (${u.origin}).`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new SsoError(`Cannot resolve ${host}.`);
  if (!addresses.every((a) => isPublicAddress(a.address)))
    throw new SsoError(
      `${host} is not a public address. For an identity provider on your network, the server administrator adds ${u.origin} to SSO_TRUSTED_ORIGINS.`,
    );
}

/** DNS TXT value proving the domain: deterministic, so nothing to store. */
export function domainProof(providerId: string): string {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(`inframole-sso:${providerId}`)
    .digest("base64url")
    .slice(0, 32);
}

export const DOMAIN_RECORD_PREFIX = "_inframole-sso";

// ───────────────────────── OIDC discovery (save time) ─────────────────────────

interface Discovery {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

/**
 * Fetches and checks the provider's discovery document, and returns the
 * endpoints the plugin will call at sign-in (stored, so no discovery happens
 * then). SSRF-safe: public destinations only, except trusted origins.
 */
export async function discoverOidc(issuer: string): Promise<Discovery> {
  const url = `${issuer}/.well-known/openid-configuration`;
  let text: string;
  let status: number;
  try {
    if (trustedOrigin(url)) {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      status = res.status;
      text = await res.text();
    } else {
      const res = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 512 * 1024 });
      status = res.status;
      text = res.text;
    }
  } catch (error) {
    throw new SsoError(
      `Could not reach ${url}: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
  }
  if (status !== 200) throw new SsoError(`${url} answered HTTP ${status}.`);
  let doc: Discovery;
  try {
    doc = JSON.parse(text) as Discovery;
  } catch {
    throw new SsoError(`${url} is not an OpenID Connect discovery document.`);
  }
  if (doc.issuer?.replace(/\/+$/, "") !== issuer)
    throw new SsoError(`The provider says its issuer is "${doc.issuer}", not "${issuer}".`);
  await assertCallable("authorization endpoint", doc.authorization_endpoint);
  await assertCallable("token endpoint", doc.token_endpoint);
  await assertCallable("keys (jwks_uri)", doc.jwks_uri);
  if (doc.userinfo_endpoint) await assertCallable("userinfo endpoint", doc.userinfo_endpoint);
  return doc;
}

// ───────────────────────── views ─────────────────────────

export interface SsoConnectionView {
  id: string;
  protocol: "OIDC" | "SAML" | "LDAP";
  name: string;
  providerId: string;
  domain: string;
  domainVerified: boolean;
  defaultRole: SsoRole | null;
  groupsClaim: string;
  groupRules: GroupRole[];
  enforced: boolean;
  enabled: boolean;
  createdAt: Date;
  /** OIDC issuer (shown, never the secret). */
  issuer: string | null;
  clientId: string | null;
  /** SAML: the certificate InfraMole signs requests with. */
  spCertificate: string | null;
  /** LDAP settings without the service account's password. */
  ldap: LdapSettingsView | null;
}

function storedLdap(row: {
  workspaceId: string;
  providerId: string;
  ldapCiphertext: string | null;
  ldapIv: string | null;
  ldapKeyVersion: number | null;
}): LdapSettings | null {
  if (!row.ldapCiphertext || !row.ldapIv || row.ldapKeyVersion === null) return null;
  try {
    return openLdapSettings(
      { ciphertext: row.ldapCiphertext, iv: row.ldapIv, keyVersion: row.ldapKeyVersion },
      row.workspaceId,
      row.providerId,
    );
  } catch {
    return null;
  }
}

/** URLs the identity provider administrator needs. */
export function serviceProviderDetails(providerId: string) {
  const base = getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
  return {
    redirectUri: `${base}/api/auth/sso/callback/${providerId}`,
    acsUrl: `${base}/api/auth/sso/saml2/sp/acs/${providerId}`,
    entityId: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
    metadataUrl: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
  };
}

const rulesOf = (json: Prisma.JsonValue): GroupRole[] =>
  Array.isArray(json) ? (json as unknown as GroupRole[]) : [];

export async function listSsoConnections(ctx: WorkspaceContext): Promise<SsoConnectionView[]> {
  assertRole(ctx, "ADMIN");
  const rows = await tenantDb(ctx).workspaceSso.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
  });
  const providers = await ssoDb().ssoProvider.findMany({
    where: { providerId: { in: rows.map((r) => r.providerId) } },
    select: { providerId: true, issuer: true, oidcConfig: true, samlConfig: true },
  });
  const byId = new Map(providers.map((p) => [p.providerId, p]));
  return rows.map((r) => {
    const p = byId.get(r.providerId);
    const oidc = p?.oidcConfig ? (JSON.parse(p.oidcConfig) as { clientId?: string }) : null;
    return {
      id: r.id,
      protocol: r.protocol,
      name: r.name,
      providerId: r.providerId,
      domain: r.domain,
      domainVerified: r.domainVerified,
      defaultRole: (r.defaultRole as SsoRole | null) ?? null,
      groupsClaim: r.groupsClaim,
      groupRules: rulesOf(r.groupRoles),
      enforced: r.enforced,
      enabled: r.enabled,
      createdAt: r.createdAt,
      issuer: r.protocol === "OIDC" ? (p?.issuer ?? null) : null,
      clientId: oidc?.clientId ?? null,
      spCertificate: spCertificateOf(p?.samlConfig ?? null),
      ldap: r.protocol === "LDAP" ? viewOf(storedLdap(r)) : null,
    };
  });
}

function viewOf(settings: LdapSettings | null): LdapSettingsView | null {
  if (!settings) return null;
  return {
    url: settings.url,
    bindDn: settings.bindDn,
    baseDn: settings.baseDn,
    userFilter: settings.userFilter,
  };
}

// ───────────────────────── mutations (OWNER) ─────────────────────────

/** Settings sealed for a connection, after the directory accepted them. */
async function checkedLdap(settings: LdapSettings, workspaceId: string, providerId: string) {
  try {
    await testLdapSettings(settings);
  } catch (error) {
    if (error instanceof LdapError) throw new SsoError(error.message);
    throw error;
  }
  const sealed = sealLdapSettings(settings, workspaceId, providerId);
  return {
    ldapCiphertext: sealed.ciphertext,
    ldapIv: sealed.iv,
    ldapKeyVersion: sealed.keyVersion,
  };
}

function ldapSettingsOf(input: z.infer<typeof ldapInputSchema>, password: string): LdapSettings {
  return {
    url: input.url,
    bindDn: input.bindDn,
    bindPassword: password,
    baseDn: input.baseDn,
    userFilter: input.userFilter,
  };
}

function parseInput(raw: unknown) {
  const input = ssoInputSchema.parse(raw);
  const rules = parseGroupRules(input.groupRules);
  if (!rules.ok) throw new SsoError(rules.error);
  if (!rules.rules.length && !input.defaultRole)
    throw new SsoError("Map at least one group to a role, or choose a default role.");
  return { input, rules: rules.rules };
}

async function oidcConfigJson(
  input: z.infer<typeof oidcInputSchema>,
  clientSecret: string,
): Promise<string> {
  const doc = await discoverOidc(input.issuer);
  const methods = doc.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  return JSON.stringify({
    issuer: input.issuer,
    clientId: input.clientId,
    clientSecret,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksEndpoint: doc.jwks_uri,
    userInfoEndpoint: doc.userinfo_endpoint,
    discoveryEndpoint: `${input.issuer}/.well-known/openid-configuration`,
    tokenEndpointAuthentication: methods.includes("client_secret_basic")
      ? "client_secret_basic"
      : "client_secret_post",
    pkce: true,
    scopes: ["openid", "email", "profile", ...input.extraScopes.split(" ").filter(Boolean)],
    mapping: { email: "email", name: "name" },
    overrideUserInfo: false,
  });
}

interface SpKeys {
  certPem: string;
  keyPem: string;
}

/**
 * SAML settings for the plugin. InfraMole always signs its authentication
 * requests (many IdPs require it, none mind) with the connection's own key,
 * and publishes full SP metadata including that certificate.
 */
function samlConfigJson(providerId: string, idpMetadata: string, keys: SpKeys): string {
  const sp = serviceProviderDetails(providerId);
  const nameId = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
  const metadata = samlify
    .SPMetadata({
      entityID: sp.entityId,
      assertionConsumerService: [
        { Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST", Location: sp.acsUrl },
      ],
      wantAssertionsSigned: true,
      authnRequestsSigned: true,
      signingCert: keys.certPem,
      nameIDFormat: [nameId],
    })
    .getMetadata();
  return JSON.stringify({
    issuer: sp.entityId,
    entryPoint: "",
    idpMetadata: { metadata: idpMetadata },
    spMetadata: { metadata, privateKey: keys.keyPem },
    privateKey: keys.keyPem,
    spCertificate: keys.certPem,
    wantAssertionsSigned: true,
    authnRequestsSigned: true,
    identifierFormat: nameId,
    mapping: { email: "email" },
  });
}

/** The SP certificate of a SAML connection (shown to the IdP administrator). */
export function spCertificateOf(samlConfig: string | null): string | null {
  if (!samlConfig) return null;
  return (JSON.parse(samlConfig) as { spCertificate?: string }).spCertificate ?? null;
}

export async function createSsoConnection(ctx: WorkspaceContext, raw: unknown) {
  assertRole(ctx, "OWNER");
  assertSsoAvailable();
  const { input, rules } = parseInput(raw);
  if (input.protocol === "OIDC" && !input.clientSecret)
    throw new SsoError("The client secret is required.");
  if (input.protocol === "SAML" && !input.idpMetadata)
    throw new SsoError("Paste the identity provider's metadata XML.");
  if (input.protocol === "LDAP" && !input.bindPassword)
    throw new SsoError("The service account's password is required.");
  const taken = await systemDb("SSO: is this domain already connected").workspaceSso.findFirst({
    where: { domain: input.domain, domainVerified: true },
    select: { workspaceId: true },
  });
  if (taken) throw new SsoError(`${input.domain} is already connected to a workspace.`);

  const providerId = `sso-${randomBytes(8).toString("hex")}`;
  const verified = operatorTrustsDomain(input.domain);
  const oidcConfig =
    input.protocol === "OIDC" ? await oidcConfigJson(input, input.clientSecret) : null;
  const issuer =
    input.protocol === "OIDC" ? input.issuer : serviceProviderDetails(providerId).entityId;
  // LDAP is run by InfraMole itself (./ldap.ts), not by the SSO plugin.
  const ldap =
    input.protocol === "LDAP"
      ? await checkedLdap(ldapSettingsOf(input, input.bindPassword), ctx.workspaceId, providerId)
      : null;

  if (input.protocol !== "LDAP")
    await ssoDb().ssoProvider.create({
      data: {
        id: randomBytes(16).toString("hex"),
        providerId,
        issuer,
        domain: input.domain,
        domainVerified: verified,
        oidcConfig,
        samlConfig:
          input.protocol === "SAML"
            ? samlConfigJson(
                providerId,
                input.idpMetadata,
                createSpCertificate(`InfraMole SSO ${providerId}`),
              )
            : null,
        userId: ctx.userId,
      },
    });
  try {
    return await tenantDb(ctx).$transaction(async (tx) => {
      const row = await tx.workspaceSso.create({
        data: {
          workspaceId: ctx.workspaceId,
          protocol: input.protocol,
          name: input.name,
          providerId,
          domain: input.domain,
          domainVerified: verified,
          defaultRole: input.defaultRole,
          groupsClaim: input.groupsClaim,
          groupRoles: rules as unknown as Prisma.InputJsonValue,
          enforced: input.enforced && verified,
          ...ldap,
          createdById: ctx.userId,
        },
        select: { id: true, providerId: true },
      });
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        action: "sso.connection_created",
        actor: userActor(ctx),
        target: { type: "sso_connection", id: row.id, label: input.name },
        metadata: { protocol: input.protocol, domain: input.domain, verified },
      });
      return row;
    });
  } catch (error) {
    await ssoDb()
      .ssoProvider.delete({ where: { providerId } })
      .catch(() => undefined);
    throw error;
  }
}

async function ownConnection(ctx: WorkspaceContext, id: string) {
  const row = await tenantDb(ctx).workspaceSso.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
  });
  if (!row) throw new SsoError("Connection not found.");
  return row;
}

export async function updateSsoConnection(ctx: WorkspaceContext, id: string, raw: unknown) {
  assertRole(ctx, "OWNER");
  assertSsoAvailable();
  const row = await ownConnection(ctx, id);
  const { input, rules } = parseInput(raw);
  if (input.protocol !== row.protocol) throw new SsoError("The protocol cannot change.");
  if (input.domain !== row.domain)
    throw new SsoError("The domain cannot change: delete the connection and create a new one.");
  const provider = await ssoDb().ssoProvider.findUnique({
    where: { providerId: row.providerId },
  });
  let ldap: Awaited<ReturnType<typeof checkedLdap>> | null = null;
  if (input.protocol === "LDAP") {
    const password = input.bindPassword || storedLdap(row)?.bindPassword || "";
    if (!password) throw new SsoError("The service account's password is required.");
    ldap = await checkedLdap(ldapSettingsOf(input, password), ctx.workspaceId, row.providerId);
  } else if (!provider) {
    throw new SsoError("Connection not found.");
  } else if (input.protocol === "OIDC") {
    const stored = JSON.parse(provider.oidcConfig ?? "{}") as { clientSecret?: string };
    const secret = input.clientSecret || stored.clientSecret || "";
    await ssoDb().ssoProvider.update({
      where: { providerId: row.providerId },
      data: { issuer: input.issuer, oidcConfig: await oidcConfigJson(input, secret) },
    });
  } else if (input.idpMetadata) {
    // New IdP metadata; the SP keeps its key and certificate.
    const stored = JSON.parse(provider.samlConfig ?? "{}") as {
      privateKey?: string;
      spCertificate?: string;
    };
    const keys =
      stored.privateKey && stored.spCertificate
        ? { keyPem: stored.privateKey, certPem: stored.spCertificate }
        : createSpCertificate(`InfraMole SSO ${row.providerId}`);
    await ssoDb().ssoProvider.update({
      where: { providerId: row.providerId },
      data: { samlConfig: samlConfigJson(row.providerId, input.idpMetadata, keys) },
    });
  }
  await tenantDb(ctx).$transaction(async (tx) => {
    await tx.workspaceSso.update({
      where: { id: row.id },
      data: {
        name: input.name,
        defaultRole: input.defaultRole,
        groupsClaim: input.groupsClaim,
        groupRoles: rules as unknown as Prisma.InputJsonValue,
        enforced: input.enforced && row.domainVerified,
        ...ldap,
      },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "sso.connection_updated",
      actor: userActor(ctx),
      target: { type: "sso_connection", id: row.id, label: input.name },
    });
  });
}

export async function setSsoEnabled(ctx: WorkspaceContext, id: string, enabled: boolean) {
  assertRole(ctx, "OWNER");
  const row = await ownConnection(ctx, id);
  await tenantDb(ctx).$transaction(async (tx) => {
    await tx.workspaceSso.update({ where: { id: row.id }, data: { enabled } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "sso.connection_updated",
      actor: userActor(ctx),
      target: { type: "sso_connection", id: row.id, label: row.name },
      metadata: { enabled },
    });
  });
}

export async function deleteSsoConnection(ctx: WorkspaceContext, id: string) {
  assertRole(ctx, "OWNER");
  const row = await ownConnection(ctx, id);
  await tenantDb(ctx).$transaction(async (tx) => {
    await tx.workspaceSso.delete({ where: { id: row.id } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "sso.connection_deleted",
      actor: userActor(ctx),
      target: { type: "sso_connection", id: row.id, label: row.name },
      metadata: { domain: row.domain },
    });
  });
  // Accounts linked through it stay (people keep any other sign-in method).
  await ssoDb()
    .ssoProvider.delete({ where: { providerId: row.providerId } })
    .catch(() => undefined);
}

/**
 * Checks the DNS proof: a TXT record `_inframole-sso.<domain>` containing
 * the connection's token. Verified connections are unique per domain.
 */
export async function verifySsoDomain(
  ctx: WorkspaceContext,
  id: string,
  resolve: (name: string) => Promise<string[][]> = resolveTxt,
) {
  assertRole(ctx, "OWNER");
  const row = await ownConnection(ctx, id);
  if (row.domainVerified) return { verified: true };
  const name = `${DOMAIN_RECORD_PREFIX}.${row.domain}`;
  const records = await resolve(name).catch(() => [] as string[][]);
  const expected = domainProof(row.providerId);
  if (!records.some((parts) => parts.join("").trim() === expected))
    throw new SsoError(`No TXT record "${expected}" found at ${name} yet. DNS can take a while.`);
  const taken = await systemDb("SSO: verified domain uniqueness").workspaceSso.findFirst({
    where: { domain: row.domain, domainVerified: true, id: { not: row.id } },
    select: { id: true },
  });
  if (taken) throw new SsoError(`${row.domain} is already connected to another workspace.`);
  await ssoDb().ssoProvider.updateMany({
    where: { providerId: row.providerId },
    data: { domainVerified: true },
  });
  await tenantDb(ctx).$transaction(async (tx) => {
    await tx.workspaceSso.update({ where: { id: row.id }, data: { domainVerified: true } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "sso.domain_verified",
      actor: userActor(ctx),
      target: { type: "sso_connection", id: row.id, label: row.name },
      metadata: { domain: row.domain },
    });
  });
  return { verified: true };
}

// ───────────────────────── sign-in ─────────────────────────

export interface SsoRoute {
  providerId: string;
  protocol: "OIDC" | "SAML" | "LDAP";
  enforced: boolean;
  name: string;
}

/** The enabled, verified connection for an email's domain, if any. */
export async function ssoForEmail(email: string): Promise<SsoRoute | null> {
  const domain = emailDomain(email);
  if (!domain || !ssoAvailable()) return null;
  const row = await systemDb("SSO: route a sign-in by email domain").workspaceSso.findFirst({
    where: { domain, domainVerified: true, enabled: true },
    select: { providerId: true, protocol: true, enforced: true, name: true },
  });
  return row;
}

/** Role decided at resolution, applied once the account exists (same request). */
const pending = new Map<string, { role: SsoRole; at: number }>();
const pendingKey = (providerId: string, email: string) => `${providerId}:${email.toLowerCase()}`;

export type SsoDecision =
  | { action: "continue" }
  | { action: "link"; userId: string }
  | { action: "reject"; code: string; message: string };

/**
 * Who may sign in through a provider, with which role (Better Auth
 * `resolveUser`, every SSO sign-in, after the plugin verified the response).
 */
export async function decideSsoSignIn(input: {
  providerId: string;
  email: string;
  claims: Record<string, unknown>;
}): Promise<SsoDecision> {
  const db = systemDb("SSO: resolve a sign-in");
  const conn = await db.workspaceSso.findUnique({ where: { providerId: input.providerId } });
  if (!conn || !conn.enabled || !conn.domainVerified || !ssoAvailable())
    return { action: "reject", code: "sso_disabled", message: "This sign-in is not enabled." };
  // The identity provider may only vouch for its own verified domain.
  if (emailDomain(input.email) !== conn.domain)
    return {
      action: "reject",
      code: "sso_wrong_domain",
      message: `Only ${conn.domain} accounts can sign in here.`,
    };
  const role = roleFor(
    groupsFrom(input.claims[conn.groupsClaim]),
    rulesOf(conn.groupRoles),
    (conn.defaultRole as SsoRole | null) ?? null,
  );
  const user = await getDb().user.findUnique({
    where: { email: input.email.toLowerCase() },
    select: { id: true },
  });
  if (!role) {
    if (user) await removeSsoMembership(conn.workspaceId, user.id, conn.name);
    return {
      action: "reject",
      code: "sso_no_access",
      message: "Your directory groups give you no access to this workspace.",
    };
  }
  pending.set(pendingKey(conn.providerId, input.email), { role, at: Date.now() });
  return user ? { action: "link", userId: user.id } : { action: "continue" };
}

/** Membership with the decided role (Better Auth `provisionUser`, every SSO sign-in). */
export async function provisionSsoUser(providerId: string, user: { id: string; email: string }) {
  const key = pendingKey(providerId, user.email);
  const decided = pending.get(key);
  pending.delete(key);
  for (const [k, v] of pending) if (Date.now() - v.at > 60_000) pending.delete(k);
  if (!decided) return;
  const conn = await systemDb("SSO: membership on sign-in").workspaceSso.findUnique({
    where: { providerId },
    select: { workspaceId: true, name: true },
  });
  if (!conn) return;
  await applySsoRole(conn.workspaceId, user.id, decided.role, conn.name);
}

/** Creates the membership or moves its role; never touches an OWNER. */
export async function applySsoRole(
  workspaceId: string,
  userId: string,
  role: SsoRole,
  connection: string,
) {
  const db = systemDb("SSO: apply the directory role");
  await db.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (current?.role === "OWNER" || current?.role === role) return;
    const actor = { type: "SYSTEM" as const, label: `Single sign-on (${connection})` };
    if (!current) {
      await tx.membership.create({ data: { workspaceId, userId, role } });
      await recordAudit(tx, {
        workspaceId,
        action: "member.joined",
        actor,
        target: { type: "user", id: userId },
        metadata: { role, via: "sso" },
        meta: { ip: null, userAgent: null },
      });
    } else {
      await tx.membership.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role },
      });
      await recordAudit(tx, {
        workspaceId,
        action: "member.role_changed",
        actor,
        target: { type: "user", id: userId },
        metadata: { from: current.role, to: role, via: "sso" },
        meta: { ip: null, userAgent: null },
      });
    }
  });
}

/** Someone the directory no longer allows: out of the workspace (owners stay). */
async function removeSsoMembership(workspaceId: string, userId: string, connection: string) {
  const db = systemDb("SSO: remove a member the directory no longer allows");
  await db.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!current || current.role === "OWNER") return;
    await tx.membership.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
    await recordAudit(tx, {
      workspaceId,
      action: "member.removed",
      actor: { type: "SYSTEM", label: `Single sign-on (${connection})` },
      target: { type: "user", id: userId },
      metadata: { via: "sso", reason: "no mapped group" },
      meta: { ip: null, userAgent: null },
    });
  });
}

/** Password sign-in / sign-up / reset refused for a domain whose connection is enforced. */
export async function ssoEnforcedFor(email: string): Promise<SsoRoute | null> {
  const route = await ssoForEmail(email);
  return route?.enforced ? route : null;
}

/**
 * LDAP sign-in (M33): the directory checks the password, then the same
 * rules as every SSO sign-in decide access and role. A wrong email, a wrong
 * password and an unknown entry all read the same.
 */
export async function checkLdapSignIn(
  email: string,
  password: string,
): Promise<
  | { ok: true; providerId: string; dn: string; name: string; decision: SsoDecision }
  | { ok: false; code: string; message: string }
> {
  const wrong = {
    ok: false as const,
    code: "invalid_credentials",
    message: "Email or password is incorrect.",
  };
  const route = await ssoForEmail(email);
  if (!route || route.protocol !== "LDAP") return wrong;
  const conn = await systemDb("SSO: LDAP sign-in settings").workspaceSso.findUnique({
    where: { providerId: route.providerId },
  });
  const settings = conn ? storedLdap(conn) : null;
  if (!conn || !settings)
    return { ok: false, code: "sso_disabled", message: "This sign-in is not enabled." };
  let identity;
  try {
    identity = await ldapAuthenticate(settings, conn.groupsClaim, email, password);
  } catch (error) {
    console.error(
      "[sso] LDAP sign-in failed for connection",
      conn.providerId,
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      ok: false,
      code: "sso_unavailable",
      message: "Your organization's directory could not be reached. Try again later.",
    };
  }
  if (!identity) return wrong;
  const decision = await decideSsoSignIn({
    providerId: conn.providerId,
    email,
    claims: { [conn.groupsClaim]: identity.groups },
  });
  if (decision.action === "reject")
    return { ok: false, code: decision.code, message: decision.message };
  return { ok: true, providerId: conn.providerId, dn: identity.dn, name: identity.name, decision };
}
