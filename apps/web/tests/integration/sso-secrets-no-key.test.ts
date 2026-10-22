// SPDX-License-Identifier: AGPL-3.0-only
/** Without CREDENTIALS_ENCRYPTION_KEY no SSO connection can be created (ADR-053). */
import { afterAll, beforeEach, expect, it } from "vitest";
import { createSsoConnection } from "@/server/modules/sso/sso";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

// Before the env is first read (each test file has its own module registry).
delete process.env.CREDENTIALS_ENCRYPTION_KEY;
process.env.SSO_TRUSTED_DOMAINS = "uni.example";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

it("asks the administrator for the encryption key first", async () => {
  const user = await createTestUser("Uni");
  const ws = await createWorkspace(user.id, { name: "Uni" });
  const owner = (await findWorkspaceContextForUser(user.id, ws.slug))!;
  await expect(
    createSsoConnection(owner, {
      protocol: "SAML",
      name: "University login",
      domain: "uni.example",
      idpMetadata: "<EntityDescriptor/>",
      defaultRole: "VIEWER",
    }),
  ).rejects.toThrow("sets CREDENTIALS_ENCRYPTION_KEY first");
  expect(await adminDb().ssoProvider.count()).toBe(0);
});
