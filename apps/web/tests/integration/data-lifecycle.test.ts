// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { previewImport } from "@/server/modules/importers/importers";
import { createIntegration } from "@/server/modules/integrations/integrations";
import { createRelationship } from "@/server/modules/relationships/relationships";
import { createResource } from "@/server/modules/resources/resources";
import { exportWorkspace } from "@/server/modules/workspaces/export";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterAll(() => adminDb().$disconnect());

async function ownerContext(userId: string, name: string): Promise<WorkspaceContext> {
  const ws = await createWorkspace(userId, { name });
  return (await findWorkspaceContextForUser(userId, ws.slug))!;
}

describe("workspace export", () => {
  it("is re-importable, audited, ADMIN+ only, and contains no secrets", async () => {
    const owner = await createTestUser("Owner");
    const ctx = await ownerContext(owner.id, "Acme");
    const app = await createResource(ctx, {
      name: "APP01",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.5"] },
    });
    const db = await createResource(ctx, { name: "SQL01", type: "DATABASE" });
    await createRelationship(ctx, {
      fromResourceId: app.id,
      toResourceId: db.id,
      type: "USES_DATABASE",
    });
    await createIntegration(ctx, {
      kind: "CLOUDFLARE",
      name: "CF",
      config: {},
      secret: { apiToken: "cf_secret_token_1234567890abcd" },
    });
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 1 });

    const data = await exportWorkspace(ctx);
    expect(data.format).toBe("depmap-workspace-export/1");
    expect(data.resources.map((r) => r.name).sort()).toEqual(["APP01", "SQL01"]);
    expect(data.relationships).toHaveLength(1);
    const dump = JSON.stringify(data);
    for (const secret of ["cf_secret_token_1234567890abcd", token])
      expect(dump).not.toContain(secret);
    expect(dump).not.toMatch(/secretCiphertext|secretHash|tokenHash/);

    // Round trip into another workspace through the JSON importer.
    const other = await ownerContext(owner.id, "Copy");
    const plan = await previewImport(other, { text: JSON.stringify(data), format: "json" });
    expect(plan.errors).toEqual([]);
    expect(plan.counts).toMatchObject({ create: 2, relationships: 1 });

    expect(
      await adminDb().auditEvent.count({
        where: { action: "workspace.exported", workspaceId: ctx.workspaceId },
      }),
    ).toBe(1);

    const member = await createTestUser("Member");
    await adminDb().membership.create({
      data: { workspaceId: ctx.workspaceId, userId: member.id, role: "MEMBER" },
    });
    const mctx = (await findWorkspaceContextForUser(member.id, ctx.workspaceSlug))!;
    await expect(exportWorkspace(mctx)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("account deletion", () => {
  const PASSWORD = "correct-horse-battery";

  async function signedIn(email: string) {
    await getAuth().api.signUpEmail({ body: { name: "Dana", email, password: PASSWORD } });
    const { headers } = await getAuth().api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const user = await adminDb().user.findUniqueOrThrow({ where: { email } });
    return { user, headers: new Headers({ cookie }) };
  }

  it("deletes solo workspaces, leaves shared ones, refuses while sole owner of a team", async () => {
    const { user, headers } = await signedIn("dana@example.test");
    const solo = await ownerContext(user.id, "Dana Lab");
    await createResource(solo, { name: "NAS", type: "STORAGE" });

    const colleague = await createTestUser("Colleague");
    const team = await ownerContext(user.id, "Team");
    await adminDb().membership.create({
      data: { workspaceId: team.workspaceId, userId: colleague.id, role: "MEMBER" },
    });

    await expect(
      getAuth().api.deleteUser({ body: { password: PASSWORD }, headers }),
    ).rejects.toThrow(/only owner of Team/);
    expect(await adminDb().user.count({ where: { id: user.id } })).toBe(1);

    // Hand over ownership, then delete.
    await adminDb().membership.update({
      where: { workspaceId_userId: { workspaceId: team.workspaceId, userId: colleague.id } },
      data: { role: "OWNER" },
    });
    await getAuth().api.deleteUser({ body: { password: PASSWORD }, headers });

    expect(await adminDb().user.count({ where: { id: user.id } })).toBe(0);
    expect(await adminDb().workspace.count({ where: { id: solo.workspaceId } })).toBe(0);
    expect(await adminDb().resource.count({ where: { workspaceId: solo.workspaceId } })).toBe(0);
    expect(await adminDb().membership.count({ where: { workspaceId: team.workspaceId } })).toBe(1);
    expect(
      await adminDb().auditEvent.findFirst({
        where: { workspaceId: team.workspaceId, action: "member.left" },
      }),
    ).toMatchObject({ metadata: { reason: "account deleted" } });
    expect(
      await adminDb().auditEvent.findFirst({
        where: { workspaceId: null, action: "auth.account_deleted", actorId: user.id },
      }),
    ).toMatchObject({ metadata: { workspacesDeleted: 1, workspacesLeft: 1 } });
  });
});
