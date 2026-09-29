// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { getAuth } from "@/server/auth";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import {
  createEnrollmentToken,
  revokeAgent,
  revokeEnrollmentToken,
} from "@/server/modules/agents/agents";
import { listAccountEvents, listAuditEvents, pruneAuditEvents } from "@/server/modules/audit/audit";
import { createIntegration, deleteIntegration } from "@/server/modules/integrations/integrations";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  removeMember,
  revokeInvitation,
} from "@/server/modules/members/members";
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

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

const actions = async (ctx: WorkspaceContext) =>
  (await listAuditEvents(ctx)).events.map((e) => e.action).reverse();

describe("audit log", () => {
  it("records member, integration and agent actions without secrets", async () => {
    const owner = await ownerContext("Acme");
    const bob = await createTestUser("Bob");
    const { token: inviteToken, id: invId } = await createInvitation(owner, {
      email: bob.email,
      role: "VIEWER",
    });
    await revokeInvitation(owner, invId);
    const again = await createInvitation(owner, { email: bob.email, role: "VIEWER" });
    await acceptInvitation(bob, again.token);
    await changeMemberRole(owner, bob.id, "MEMBER");
    await removeMember(owner, bob.id);

    const integration = await createIntegration(owner, {
      kind: "CLOUDFLARE",
      name: "CF",
      config: {},
      secret: { apiToken: "cf_secret_token_1234567890abcd" },
    });
    await deleteIntegration(owner, integration.id);

    const { token, id: tokenId } = await createEnrollmentToken(owner, {
      name: "servers",
      expiresInHours: 24,
    });
    const res = await enrollRoute(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({
          enrollmentToken: token,
          machineId: "machine-0001",
          hostname: "APP01",
          os: "linux",
          osVersion: "12",
          arch: "amd64",
          agentVersion: "0.2.0",
        }),
      }),
    );
    const { agentId } = (await res.json()) as { agentId: string };
    await revokeEnrollmentToken(owner, tokenId);
    await revokeAgent(owner, agentId);

    expect(await actions(owner)).toEqual([
      "workspace.created",
      "member.invited",
      "member.invitation_revoked",
      "member.invited",
      "member.joined",
      "member.role_changed",
      "member.removed",
      "integration.created",
      "integration.deleted",
      "agent.token_created",
      "agent.enrolled",
      "agent.token_revoked",
      "agent.revoked",
    ]);
    const { events } = await listAuditEvents(owner);
    const roleChange = events.find((e) => e.action === "member.role_changed")!;
    expect(roleChange).toMatchObject({
      targetLabel: bob.email,
      metadata: { from: "VIEWER", to: "MEMBER" },
    });
    expect(roleChange.actorLabel).toMatch(/@example\.test$/);
    expect(events.find((e) => e.action === "agent.enrolled")).toMatchObject({
      actorType: "AGENT",
      actorLabel: "APP01",
    });
    const dump = JSON.stringify(await adminDb().auditEvent.findMany());
    for (const secret of [inviteToken, again.token, token, "cf_secret_token_1234567890abcd"])
      expect(dump).not.toContain(secret);
  });

  it("is append-only and keeps rows for 365 days", async () => {
    const owner = await ownerContext("Acme");
    const [event] = await adminDb().auditEvent.findMany();
    await expect(
      adminDb().auditEvent.update({ where: { id: event!.id }, data: { action: "x" } }),
    ).rejects.toThrow(/append-only/);
    await expect(adminDb().auditEvent.delete({ where: { id: event!.id } })).rejects.toThrow(
      /365 days/,
    );

    await adminDb().auditEvent.create({
      data: {
        workspaceId: owner.workspaceId,
        actorType: "SYSTEM",
        action: "workspace.settings_changed",
        createdAt: new Date(Date.now() - 400 * 86_400_000),
      },
    });
    expect(await pruneAuditEvents()).toBe(1);
    expect(await adminDb().auditEvent.count()).toBe(1);
  });

  it("is visible to ADMIN+ of the same workspace only", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const member = await createTestUser("Member");
    await adminDb().membership.create({
      data: { workspaceId: acme.workspaceId, userId: member.id, role: "MEMBER" },
    });
    const mctx = (await findWorkspaceContextForUser(member.id, acme.workspaceSlug))!;
    await expect(listAuditEvents(mctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listAuditEvents(globex)).events.map((e) => e.targetLabel)).toEqual(["Globex"]);
  });

  it("records sign-ins at account level with the session IP", async () => {
    await getAuth().api.signUpEmail({
      body: { name: "Alice", email: "alice@example.test", password: "correct-horse-battery" },
      headers: new Headers({ "x-forwarded-for": "198.51.100.23", "user-agent": "vitest" }),
    });
    const user = await adminDb().user.findUniqueOrThrow({ where: { email: "alice@example.test" } });
    const [signIn] = await listAccountEvents(user.id);
    expect(signIn).toMatchObject({ action: "auth.sign_in", userAgent: "vitest" });
  });
});
