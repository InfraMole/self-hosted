// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SSO secrets at rest (ADR-053): the OIDC client secret and the SAML SP
 * private key are sealed in `sso_provider`, opened only through ssoDb() —
 * the client the SSO plugin uses — and rows from before are sealed by the
 * maintenance job.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/server/authz";
import { getAuth } from "@/server/auth";
import { buildKeyring } from "@/server/crypto";
import { createSsoConnection } from "@/server/modules/sso/sso";
import {
  configNeedsSealing,
  openConfig,
  sealConfig,
  sealStoredSsoSecrets,
  ssoDb,
} from "@/server/modules/sso/sso-secrets";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

process.env.SSO_TRUSTED_DOMAINS = "uni.example";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

const IDP_METADATA = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.uni.example/realms/uni">
  <IDPSSODescriptor WantAuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.uni.example/saml"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

async function samlConnection() {
  const owner = await ownerContext("Uni");
  const row = await createSsoConnection(owner, {
    protocol: "SAML",
    name: "University login",
    domain: "uni.example",
    idpMetadata: IDP_METADATA,
    groupRules: "it-admins = admin",
  });
  return row.providerId;
}

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const OIDC = JSON.stringify({ clientId: "inframole", clientSecret: "s3cret-value", pkce: true });

describe("SSO secrets at rest", () => {
  it("stores the SAML private key sealed and opens it for the plugin", async () => {
    const providerId = await samlConnection();
    const raw = await adminDb().ssoProvider.findUniqueOrThrow({ where: { providerId } });
    expect(raw.samlConfig).not.toContain("PRIVATE KEY");
    expect(raw.samlConfig).toContain('"privateKey":"sealed:v1:1:');
    expect(raw.samlConfig).toContain("BEGIN CERTIFICATE"); // public, stays readable

    const opened = await ssoDb().ssoProvider.findUniqueOrThrow({
      where: { providerId },
      select: { samlConfig: true },
    });
    expect(opened).not.toHaveProperty("providerId");
    const config = JSON.parse(opened.samlConfig!) as {
      privateKey: string;
      spMetadata: { privateKey: string };
    };
    expect(config.privateKey).toContain("BEGIN PRIVATE KEY");
    expect(config.spMetadata.privateKey).toBe(config.privateKey);

    // The plugin signs the authentication request with the opened key.
    const res = await getAuth().api.signInSSO({
      body: { providerId, callbackURL: "/" },
      headers: new Headers(),
    });
    const url = new URL(res.url);
    expect(url.origin).toBe("https://idp.uni.example");
    expect(url.searchParams.get("Signature")).toBeTruthy();
  });

  it("refuses a sealed config copied to another connection", async () => {
    const providerId = await samlConnection();
    const raw = await adminDb().ssoProvider.findUniqueOrThrow({ where: { providerId } });
    await adminDb().ssoProvider.create({
      data: {
        id: "copied",
        providerId: "sso-copied",
        issuer: raw.issuer,
        domain: "other.example",
        samlConfig: raw.samlConfig,
      },
    });
    await expect(
      ssoDb().ssoProvider.findUnique({ where: { providerId: "sso-copied" } }),
    ).rejects.toThrow(/could not be decrypted/);
  });

  it("seals secrets stored before, once, and reads them the same", async () => {
    await adminDb().ssoProvider.create({
      data: {
        id: "legacy",
        providerId: "sso-legacy",
        issuer: "https://idp.uni.example",
        domain: "legacy.example",
        oidcConfig: OIDC,
      },
    });
    const before = await ssoDb().ssoProvider.findUniqueOrThrow({
      where: { providerId: "sso-legacy" },
    });
    expect(JSON.parse(before.oidcConfig!).clientSecret).toBe("s3cret-value");

    expect(await sealStoredSsoSecrets()).toEqual({ sealed: 1 });
    expect(await sealStoredSsoSecrets()).toEqual({ sealed: 0 });
    const raw = await adminDb().ssoProvider.findUniqueOrThrow({
      where: { providerId: "sso-legacy" },
    });
    expect(raw.oidcConfig).not.toContain("s3cret-value");
    expect(JSON.parse(raw.oidcConfig!).clientId).toBe("inframole");
    const after = await ssoDb().ssoProvider.findMany({ where: { providerId: "sso-legacy" } });
    expect(JSON.parse(after[0]!.oidcConfig!).clientSecret).toBe("s3cret-value");
  });

  it("re-seals with a new key version and opens with the previous key", () => {
    const v1 = buildKeyring({ key: KEY_A, version: 1 });
    const v2 = buildKeyring({ key: KEY_B, previousKey: KEY_A, version: 2 });
    const sealed = sealConfig("oidcConfig", OIDC, "sso-x", v1);
    expect(configNeedsSealing("oidcConfig", sealed, v1)).toBe(false);
    expect(configNeedsSealing("oidcConfig", sealed, v2)).toBe(true);
    expect(JSON.parse(openConfig("oidcConfig", sealed, "sso-x", v2)).clientSecret).toBe(
      "s3cret-value",
    );
    const resealed = sealConfig("oidcConfig", sealed, "sso-x", v2);
    expect(resealed).toContain('"clientSecret":"sealed:v1:2:');
    expect(() => openConfig("oidcConfig", sealed, "sso-x", null)).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/,
    );
  });
});
