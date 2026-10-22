// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Key rotation reaches every SSO secret (ADR-053, DEPLOYMENT §7): after
 * CREDENTIALS_KEY_VERSION moves on, the maintenance job re-seals provider
 * secrets and LDAP settings with the new key while the previous one is
 * still configured.
 */
import { afterAll, beforeEach, expect, it } from "vitest";
import { buildKeyring, openSecret, sealSecret } from "@/server/crypto";
import {
  openConfig,
  sealConfig,
  sealStoredSsoSecrets,
  ssoDb,
} from "@/server/modules/sso/sso-secrets";
import { createWorkspace } from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

const OLD_KEY = Buffer.alloc(32, 7).toString("base64"); // tests/integration/setup.ts
const NEW_KEY = Buffer.alloc(32, 9).toString("base64");
// Before the env is first read (each test file has its own module registry).
process.env.CREDENTIALS_ENCRYPTION_KEY = NEW_KEY;
process.env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS = OLD_KEY;
process.env.CREDENTIALS_KEY_VERSION = "2";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

it("re-seals provider secrets and LDAP settings with the new key", async () => {
  const v1 = buildKeyring({ key: OLD_KEY, version: 1 });
  const user = await createTestUser("Uni");
  const ws = await createWorkspace(user.id, { name: "Uni" });
  const oidc = JSON.stringify({ clientId: "inframole", clientSecret: "s3cret-value" });
  await adminDb().ssoProvider.create({
    data: {
      id: "p1",
      providerId: "sso-p1",
      issuer: "https://idp.uni.example",
      domain: "uni.example",
      oidcConfig: sealConfig("oidcConfig", oidc, "sso-p1", v1),
    },
  });
  const settings = {
    url: "ldaps://dc01.uni.example:636",
    bindDn: "cn=svc,dc=uni,dc=example",
    bindPassword: "svc-password",
    baseDn: "dc=uni,dc=example",
    userFilter: "(mail={email})",
  };
  const sealed = sealSecret(JSON.stringify(settings), `sso-ldap:${ws.id}:sso-ldap1`, v1);
  await adminDb().workspaceSso.create({
    data: {
      workspaceId: ws.id,
      protocol: "LDAP",
      name: "Directory",
      providerId: "sso-ldap1",
      domain: "uni.example",
      ldapCiphertext: sealed.ciphertext,
      ldapIv: sealed.iv,
      ldapKeyVersion: 1,
    },
  });

  expect(await sealStoredSsoSecrets()).toEqual({ sealed: 2 });
  expect(await sealStoredSsoSecrets()).toEqual({ sealed: 0 });

  const raw = await adminDb().ssoProvider.findUniqueOrThrow({ where: { providerId: "sso-p1" } });
  expect(raw.oidcConfig).toContain('"clientSecret":"sealed:v1:2:');
  const row = await adminDb().workspaceSso.findUniqueOrThrow({
    where: { providerId: "sso-ldap1" },
  });
  expect(row.ldapKeyVersion).toBe(2);

  // Readable with the new key alone: the previous one can go.
  const v2 = buildKeyring({ key: NEW_KEY, version: 2 });
  expect(JSON.parse(openConfig("oidcConfig", raw.oidcConfig!, "sso-p1", v2)).clientSecret).toBe(
    "s3cret-value",
  );
  const ldap = openSecret(
    { ciphertext: row.ldapCiphertext!, iv: row.ldapIv!, keyVersion: 2 },
    `sso-ldap:${ws.id}:sso-ldap1`,
    v2,
  );
  expect(JSON.parse(ldap).bindPassword).toBe("svc-password");
  const opened = await ssoDb().ssoProvider.findUniqueOrThrow({ where: { providerId: "sso-p1" } });
  expect(JSON.parse(opened.oidcConfig!).clientSecret).toBe("s3cret-value");
});
