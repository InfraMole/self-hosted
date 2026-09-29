// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan limits (ADR-023) under the Cloud edition: the Team trial, paid tiers
 * with a grace period, paused discovery, seats and plan history. EDITION is
 * set before the env is first read in this file's module registry.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import type { WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import {
  MemberLimitError,
  PlanLimitError,
  PlanPausedError,
  assertDiscoveryActive,
  getUsage,
  refreshOverLimit,
} from "@/server/modules/billing/limits";
import { applyImport, previewImport } from "@/server/modules/importers/importers";
import { runRetention } from "@/server/modules/maintenance/retention";
import { createInvitation } from "@/server/modules/members/members";
import { createResource, updateResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

process.env.EDITION = "cloud";

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterAll(() => adminDb().$disconnect());

async function workspace(): Promise<WorkspaceContext> {
  const user = await createTestUser("Owner");
  const ws = await createWorkspace(user.id, { name: "Acme" });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

/** Bulk hosts straight into the DB (the limit logic only counts them). */
const seedHosts = (ctx: WorkspaceContext, n: number, prefix = "seed") =>
  adminDb().resource.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      workspaceId: ctx.workspaceId,
      name: `${prefix}-${i}`,
      type: "SERVER" as const,
    })),
  });

const subscribe = (ctx: WorkspaceContext, tier: string, status = "active") =>
  adminDb().workspaceSubscription.upsert({
    where: { workspaceId: ctx.workspaceId },
    create: { workspaceId: ctx.workspaceId, stripeCustomerId: "cus_1", status, tier },
    update: { status, tier },
  });

const endTrial = (ctx: WorkspaceContext) =>
  adminDb().workspace.update({
    where: { id: ctx.workspaceId },
    data: { trialEndsAt: new Date(Date.now() - DAY) },
  });

async function enroll(ctx: WorkspaceContext, machineId: string) {
  const { token, id } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 1 });
  const res = await enrollRoute(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({
        enrollmentToken: token,
        machineId,
        hostname: machineId,
        os: "linux",
        osVersion: "12",
        arch: "amd64",
        agentVersion: "0.2.0",
      }),
    }),
  );
  return { res, tokenId: id, body: (await res.json()) as Record<string, string> };
}

describe("Cloud trial (Team limits, 14 days)", () => {
  it("every new workspace starts a Team trial", async () => {
    const ctx = await workspace();
    const usage = await getUsage(ctx.workspaceId);
    expect(usage).toMatchObject({
      plan: "cloud-trial",
      limit: 60,
      memberLimit: 15,
      historyDays: 90,
      paused: false,
    });
    const days = (new Date(usage.trialEndsAt!).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  it("counts only servers and VMs and blocks the 61st, without touching existing data", async () => {
    const ctx = await workspace();
    await seedHosts(ctx, 60);
    await createResource(ctx, { name: "app", type: "APPLICATION" }); // free, unlimited
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ nodes: 60, limit: 60 });
    await expect(createResource(ctx, { name: "vm-61", type: "VM" })).rejects.toThrow(
      /60 of 60 servers and VMs.*nothing was removed/,
    );
    expect(await adminDb().resource.count({ where: { workspaceId: ctx.workspaceId } })).toBe(61);
  });

  it("turning something into a host counts; archiving frees a slot", async () => {
    const ctx = await workspace();
    await seedHosts(ctx, 59);
    const host = await createResource(ctx, { name: "host", type: "SERVER" });
    const app = await createResource(ctx, { name: "app", type: "APPLICATION" });
    await expect(
      updateResource(ctx, app.id, { name: "app", type: "SERVER" }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    await updateResource(ctx, host.id, { name: "host", type: "SERVER", status: "ARCHIVED" });
    await updateResource(ctx, app.id, { name: "app", type: "SERVER" }); // now fits
    await expect(
      updateResource(ctx, host.id, { name: "host", type: "SERVER", status: "ACTIVE" }),
    ).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("imports: preview warns, apply refuses all-or-nothing", async () => {
    const ctx = await workspace();
    await seedHosts(ctx, 59);
    const csv = "name,type\nweb-a,server\nweb-b,vm\ndocs,application";
    const plan = await previewImport(ctx, { text: csv, format: "csv" });
    expect(plan.warnings.join(" ")).toMatch(/59 of 60 servers and VMs.*would add 2/);
    await expect(applyImport(ctx, { text: csv, format: "csv" })).rejects.toBeInstanceOf(
      PlanLimitError,
    );
    expect(await adminDb().resource.count({ where: { name: "docs" } })).toBe(0);
  });

  it("new agents are refused with 402 (token use not consumed); known machines re-enroll", async () => {
    const ctx = await workspace();
    await seedHosts(ctx, 59);
    expect((await enroll(ctx, "machine-0001")).res.status).toBe(201);
    await createResource(ctx, { name: "machine-0001", type: "SERVER" }); // its first report
    const second = await enroll(ctx, "machine-0002");
    expect(second.res.status).toBe(402);
    expect(second.body).toMatchObject({ error: "plan_limit" });
    expect(second.body.message).toMatch(/servers and VMs/);
    expect(
      (await adminDb().enrollmentToken.findUniqueOrThrow({ where: { id: second.tokenId } }))
        .useCount,
    ).toBe(0);
    expect((await enroll(ctx, "machine-0001")).res.status).toBe(201);
  });

  it("after the trial without a plan: discovery is paused, data stays and stays editable", async () => {
    const ctx = await workspace();
    const host = await createResource(ctx, { name: "host", type: "SERVER" });
    await endTrial(ctx);
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ plan: "cloud-expired", paused: true });
    await expect(assertDiscoveryActive(ctx.workspaceId)).rejects.toBeInstanceOf(PlanPausedError);
    await expect(
      applyImport(ctx, { text: "name,type\ndocs,application", format: "csv" }),
    ).rejects.toThrow(/free trial of this workspace has ended/);
    await expect(createResource(ctx, { name: "new", type: "VM" })).rejects.toBeInstanceOf(
      PlanPausedError,
    );
    await createResource(ctx, { name: "notes", type: "APPLICATION" }); // documenting still works
    await updateResource(ctx, host.id, { name: "host", type: "SERVER", notes: "still here" });
    expect((await enroll(ctx, "machine-0003")).body.message).toMatch(
      /free trial of this workspace has ended/,
    );
  });
});

describe("paid Cloud tiers", () => {
  it("each tier sets its limits; a cancelled plan after the trial pauses discovery", async () => {
    const ctx = await workspace();
    for (const [tier, limit, members, days] of [
      ["starter", 15, 5, 30],
      ["team", 60, 15, 90],
      ["scale", 250, null, 365],
    ] as const) {
      await subscribe(ctx, tier);
      expect(await getUsage(ctx.workspaceId)).toMatchObject({
        plan: `cloud-${tier}`,
        limit,
        memberLimit: members,
        historyDays: days,
        paused: false,
      });
    }
    await subscribe(ctx, "scale", "past_due"); // Stripe retrying: plan kept
    expect((await getUsage(ctx.workspaceId)).plan).toBe("cloud-scale");
    await endTrial(ctx);
    await subscribe(ctx, "scale", "canceled");
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ plan: "cloud-expired", paused: true });
  });

  it("going over the limit starts a grace period; after it, adding hosts is blocked", async () => {
    const ctx = await workspace();
    await subscribe(ctx, "starter");
    await seedHosts(ctx, 15);
    await createResource(ctx, { name: "extra-1", type: "SERVER" }); // allowed: grace starts
    const ws = await adminDb().workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
    expect(ws.overLimitSince).not.toBeNull();
    expect((await getUsage(ctx.workspaceId)).graceEndsAt).toBeDefined();
    await createResource(ctx, { name: "extra-2", type: "SERVER" }); // still within grace

    await adminDb().workspace.update({
      where: { id: ctx.workspaceId },
      data: { overLimitSince: new Date(Date.now() - 15 * DAY) },
    });
    await expect(createResource(ctx, { name: "extra-3", type: "SERVER" })).rejects.toBeInstanceOf(
      PlanLimitError,
    );

    // Back under the limit: the maintenance job clears the grace period.
    await adminDb().resource.updateMany({
      where: { workspaceId: ctx.workspaceId, name: { startsWith: "extra-" } },
      data: { status: "ARCHIVED" },
    });
    expect(await refreshOverLimit()).toEqual({ started: 0, cleared: 1 });
    expect(
      (await adminDb().workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } }))
        .overLimitSince,
    ).toBeNull();
  });

  it("members: people plus pending invitations count towards the plan", async () => {
    const ctx = await workspace();
    await subscribe(ctx, "starter"); // 5 members
    for (let i = 0; i < 3; i++) {
      const u = await createTestUser(`M${i}`);
      await adminDb().membership.create({
        data: { workspaceId: ctx.workspaceId, userId: u.id, role: "MEMBER" },
      });
    }
    await createInvitation(ctx, { email: "fifth@example.test", role: "VIEWER" }); // 4 + 1
    await expect(
      createInvitation(ctx, { email: "sixth@example.test", role: "VIEWER" }),
    ).rejects.toBeInstanceOf(MemberLimitError);
    // Re-inviting the same address replaces its invitation rather than adding a seat.
    await createInvitation(ctx, { email: "fifth@example.test", role: "MEMBER" });
    await subscribe(ctx, "scale"); // unlimited
    await createInvitation(ctx, { email: "sixth@example.test", role: "VIEWER" });
  });

  it("change history is kept for the plan's days", async () => {
    const starter = await workspace();
    await subscribe(starter, "starter"); // 30 days
    const trial = await workspace(); // 90 days
    const event = (ctx: WorkspaceContext, daysAgo: number) => ({
      workspaceId: ctx.workspaceId,
      occurredAt: new Date(Date.now() - daysAgo * DAY),
      actorType: "SYSTEM" as const,
      subjectType: "RESOURCE" as const,
      subjectId: `r-${daysAgo}`,
      subjectLabel: `r-${daysAgo}`,
      kind: "UPDATED" as const,
      summary: `${daysAgo} days ago`,
    });
    await adminDb().changeEvent.createMany({
      data: [event(starter, 40), event(starter, 10), event(trial, 40), event(trial, 100)],
    });
    await runRetention();
    const left = await adminDb().changeEvent.findMany({
      where: { actorType: "SYSTEM" },
      select: { workspaceId: true, summary: true },
    });
    expect(left).toHaveLength(2);
    expect(left).toEqual(
      expect.arrayContaining([
        { workspaceId: starter.workspaceId, summary: "10 days ago" },
        { workspaceId: trial.workspaceId, summary: "40 days ago" },
      ]),
    );
  });
});
