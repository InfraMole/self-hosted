// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { POST as reportRoute } from "@/app/api/agent/v1/report/route";
import type { WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { sampleReport } from "@/server/modules/agents/fixtures";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import { listWorkspaceChanges } from "@/server/modules/changes/changes";
import { markStaleHosts, resetStalenessThrottle } from "@/server/modules/discovery/staleness";
import { createResource, deleteResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  resetStalenessThrottle();
});
afterAll(() => adminDb().$disconnect());

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function enrolledAgent(ctx: WorkspaceContext) {
  const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
  const res = await enrollRoute(
    post({
      enrollmentToken: token,
      machineId: "machine-app01",
      hostname: "APP01",
      os: "windows",
      osVersion: "10",
      arch: "amd64",
      agentVersion: "0.1.0",
    }),
  );
  const body = (await res.json()) as { agentSecret: string; agentId: string };
  return {
    agentId: body.agentId,
    report: (r: ReportV1 = sampleReport()) =>
      reportRoute(post(r, { authorization: `Bearer ${body.agentSecret}` })),
  };
}

const summaries = async (ctx: WorkspaceContext, filter: object = {}) =>
  (await listWorkspaceChanges(ctx, filter)).events.map((e) => e.summary);

describe("discovery-driven changes", () => {
  it("baseline first, then IP / service / port changes as readable events", async () => {
    const ctx = await ownerContext("Acme");
    const { report } = await enrolledAgent(ctx);
    await report();
    expect(await summaries(ctx)).toEqual(["Discovered APP01 (agent)"]);

    const next = sampleReport();
    next.interfaces[0]!.addresses = ["10.0.0.99/24"];
    next.services.push({ name: "MSSQLSERVER", state: "running" });
    next.listeners.push({ proto: "tcp", address: "0.0.0.0", port: 1433 });
    await report(next);

    const events = (await listWorkspaceChanges(ctx, {})).events;
    expect(events.map((e) => e.summary)).toEqual(
      expect.arrayContaining([
        "APP01 IP changed: 10.0.0.23 → 10.0.0.99",
        "APP01: new services MSSQLSERVER; new listening ports 1433",
      ]),
    );
    const svc = events.find((e) => e.summary.startsWith("APP01: new services"))!;
    expect(svc).toMatchObject({ actorType: "AGENT", actorName: "APP01", kind: "UPDATED" });
    expect(svc.diff).toMatchObject({ servicesStarted: ["MSSQLSERVER"], portsOpened: [1433] });

    // Same state again -> no new events.
    const before = (await listWorkspaceChanges(ctx, {})).events.length;
    await report(next);
    expect((await listWorkspaceChanges(ctx, {})).events.length).toBe(before);
  });
});

describe("staleness", () => {
  it("marks a silent host STALE once, then restores its previous status when it reports", async () => {
    const ctx = await ownerContext("Acme");
    const { agentId, report } = await enrolledAgent(ctx);
    await report();
    const host = await adminDb().resource.findFirstOrThrow({ where: { source: "AGENT" } });
    // A human reviewed it: ACTIVE.
    await adminDb().resource.update({ where: { id: host.id }, data: { status: "ACTIVE" } });
    await adminDb().agent.update({
      where: { id: agentId },
      data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) }, // > 3 × 300 s
    });

    expect(await markStaleHosts(ctx.workspaceId, { force: true })).toBe(1);
    expect(await markStaleHosts(ctx.workspaceId, { force: true })).toBe(0); // no duplicates
    expect((await adminDb().resource.findUniqueOrThrow({ where: { id: host.id } })).status).toBe(
      "STALE",
    );
    const stale = (await listWorkspaceChanges(ctx, { kind: "NO_LONGER_OBSERVED" })).events;
    expect(stale).toHaveLength(1);
    expect(stale[0]!.summary).toMatch(/^APP01 is no longer reporting \(last seen .* UTC\)$/);

    await report();
    expect((await adminDb().resource.findUniqueOrThrow({ where: { id: host.id } })).status).toBe(
      "ACTIVE",
    );
    expect(await summaries(ctx)).toContain("APP01 is reporting again");
  });

  it("is throttled per workspace unless forced", async () => {
    const ctx = await ownerContext("Acme");
    const { agentId, report } = await enrolledAgent(ctx);
    await report(); // ingestion runs the (throttled) check once
    await adminDb().agent.update({ where: { id: agentId }, data: { lastSeenAt: new Date(0) } });
    expect(await markStaleHosts(ctx.workspaceId)).toBe(0); // throttled
    expect(await markStaleHosts(ctx.workspaceId, { force: true })).toBe(1);
  });
});

describe("changes feed", () => {
  it("filters by period, actor and kind; counts; isolates workspaces", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    await createResource(acme, { name: "Web", type: "APPLICATION" });
    await createResource(globex, { name: "Secret", type: "SERVER" });
    const { report } = await enrolledAgent(acme);
    await report();
    await adminDb().changeEvent.create({
      data: {
        workspaceId: acme.workspaceId,
        actorType: "SYSTEM",
        subjectType: "RESOURCE",
        subjectId: "gone",
        subjectLabel: "Old box",
        kind: "DELETED",
        summary: "Old event",
        occurredAt: new Date(Date.now() - 10 * 86_400_000),
      },
    });

    const page = await listWorkspaceChanges(acme, {});
    expect(page.events.map((e) => e.summary)).toEqual(["Discovered APP01 (agent)", "Created Web"]);
    expect(page.counts).toEqual({ DISCOVERED: 1, CREATED: 1 });
    expect(page.events.some((e) => e.summary === "Secret" || e.subjectLabel === "Secret")).toBe(
      false,
    );

    expect(await summaries(acme, { actor: "human" })).toEqual(["Created Web"]);
    expect(await summaries(acme, { actor: "agent" })).toEqual(["Discovered APP01 (agent)"]);
    expect(await summaries(acme, { kind: "CREATED" })).toEqual(["Created Web"]);
    expect(await summaries(acme, { days: "30" })).toContain("Old event");
    // Invalid filter values fall back to defaults instead of failing.
    expect(
      (await listWorkspaceChanges(acme, { days: "999", actor: "x", kind: "NOPE" })).filter,
    ).toEqual({
      days: 7,
      actor: "all",
      kind: undefined,
      cursor: undefined,
    });
  });

  it("paginates with a cursor and only links to resources that still exist", async () => {
    const ctx = await ownerContext("Acme");
    const kept = await createResource(ctx, { name: "Kept", type: "SERVER" });
    const gone = await createResource(ctx, { name: "Gone", type: "SERVER" });
    await deleteResource(ctx, gone.id);
    await adminDb().changeEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        workspaceId: ctx.workspaceId,
        actorType: "SYSTEM" as const,
        subjectType: "RESOURCE" as const,
        subjectId: kept.id,
        subjectLabel: "Kept",
        kind: "UPDATED" as const,
        summary: `bulk ${i}`,
        occurredAt: new Date(Date.now() - (i + 1) * 60_000),
      })),
    });

    const first = await listWorkspaceChanges(ctx, {});
    expect(first.events).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const second = await listWorkspaceChanges(ctx, { cursor: first.nextCursor });
    expect(second.events).toHaveLength(23); // 120 bulk + created Kept + created/deleted Gone
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.events, ...second.events].map((e) => e.id));
    expect(ids.size).toBe(123);

    const all = [...first.events, ...second.events];
    expect(all.find((e) => e.summary === "Created Kept")!.linkResourceId).toBe(kept.id);
    expect(all.find((e) => e.summary === "Deleted Gone")!.linkResourceId).toBeNull();
  });
});
