// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { POST as reportRoute } from "@/app/api/agent/v1/report/route";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { sampleReport } from "@/server/modules/agents/fixtures";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import { listChangesForResource } from "@/server/modules/changes/changes";
import { listSuggestions } from "@/server/modules/discovery/discovery";
import {
  DiscoveryRuleError,
  createDiscoveryRule,
  deleteDiscoveryRule,
  listDiscoveryRules,
} from "@/server/modules/discovery/rules";
import { runRetention } from "@/server/modules/maintenance/retention";
import {
  confirmRelationships,
  ignoreRelationships,
  restoreRelationships,
} from "@/server/modules/relationships/relationships";
import { createResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

/** M15 (ADR-027): bulk review, undo ignore, exclusion rules, expiry, incremental discovery. */

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

async function memberContext(owner: WorkspaceContext, role: Role) {
  const user = await createTestUser(`${role} user`);
  await adminDb().membership.create({
    data: { workspaceId: owner.workspaceId, userId: user.id, role },
  });
  return (await findWorkspaceContextForUser(user.id, owner.workspaceSlug))!;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function enrolledAgent(
  ctx: WorkspaceContext,
  machineId = "machine-app01",
  hostname = "APP01",
) {
  const { token } = await createEnrollmentToken(ctx, {
    name: `t-${machineId}`,
    expiresInHours: 24,
  });
  const res = await enrollRoute(
    post({
      enrollmentToken: token,
      machineId,
      hostname,
      os: "windows",
      osVersion: "10",
      arch: "amd64",
      agentVersion: "0.1.0",
    }),
  );
  const body = (await res.json()) as { agentSecret: string };
  return (report: ReportV1 = sampleReport()) =>
    reportRoute(post(report, { authorization: `Bearer ${body.agentSecret}` }));
}

const connection = (
  remoteAddress: string,
  remotePort: number,
  processName = "w3wp.exe",
): ReportV1["connections"][number] => ({
  proto: "tcp",
  direction: "outbound",
  localPort: 0,
  remoteAddress,
  remotePort,
  process: { name: processName },
  count: 10,
  firstSeen: "2026-09-28T10:00:00Z",
  lastSeen: "2026-09-28T10:04:30Z",
});

/** APP01 talks to SQL01:1433, CACHE:6379 and BACKUP:9102 (backup agent). */
async function threeSuggestions(ctx: WorkspaceContext) {
  const sql = await createResource(ctx, {
    name: "SQL01",
    type: "SERVER",
    metadata: { ipAddresses: ["10.0.0.40"] },
  });
  const cache = await createResource(ctx, {
    name: "CACHE",
    type: "CONTAINER",
    metadata: { ipAddresses: ["10.0.0.50"] },
  });
  const backup = await createResource(ctx, {
    name: "BACKUP",
    type: "SERVER",
    metadata: { ipAddresses: ["10.0.0.60"] },
  });
  const report = await enrolledAgent(ctx);
  const traffic = sampleReport({
    connections: [
      connection("10.0.0.40", 1433),
      connection("10.0.0.50", 6379),
      connection("10.0.0.60", 9102, "bpcd.exe"),
    ],
  });
  expect((await report(traffic)).status).toBe(202);
  const list = await listSuggestions(ctx);
  expect(list).toHaveLength(3);
  const to = (id: string) => list.find((s) => s.to.id === id)!;
  return {
    sql,
    cache,
    backup,
    report: () => report(traffic),
    toSql: to(sql.id),
    toCache: to(cache.id),
    toBackup: to(backup.id),
  };
}

describe("bulk review", () => {
  it("confirms many at once, optionally with each suggestion's suggested type", async () => {
    const ctx = await ownerContext("Acme");
    const { sql, toSql, toCache, toBackup } = await threeSuggestions(ctx);

    expect(
      await confirmRelationships(ctx, [toSql.id, toCache.id, toBackup.id], {
        useSuggestedType: true,
      }),
    ).toBe(3);
    const types = Object.fromEntries(
      (await adminDb().relationship.findMany({ include: { to: true } })).map((r) => [
        r.to.name,
        [r.type, r.status],
      ]),
    );
    expect(types).toEqual({
      SQL01: ["USES_DATABASE", "CONFIRMED"],
      CACHE: ["DEPENDS_ON", "CONFIRMED"],
      BACKUP: ["CONNECTS_TO", "CONFIRMED"], // 9102: no guess, keeps its type
    });
    expect(await listSuggestions(ctx)).toEqual([]);
    expect((await listChangesForResource(ctx, sql.id))[0]).toMatchObject({
      actorType: "USER",
      kind: "CONFIRMED",
    });
    // Already reviewed ids are skipped, not errors.
    expect(await confirmRelationships(ctx, [toSql.id])).toBe(0);
  });

  it("ignores many, keeps them out of later reports, and restores them (undo ignore)", async () => {
    const ctx = await ownerContext("Acme");
    const { report, toCache, toBackup, toSql } = await threeSuggestions(ctx);

    expect(await ignoreRelationships(ctx, [toCache.id, toBackup.id])).toBe(2);
    await report();
    expect((await listSuggestions(ctx)).map((s) => s.id)).toEqual([toSql.id]);
    expect((await listSuggestions(ctx, "IGNORED")).map((s) => s.id).sort()).toEqual(
      [toCache.id, toBackup.id].sort(),
    );

    expect(await restoreRelationships(ctx, [toCache.id])).toBe(1);
    expect((await listSuggestions(ctx)).map((s) => s.id).sort()).toEqual(
      [toSql.id, toCache.id].sort(),
    );
    const events = await adminDb().changeEvent.findMany({
      where: { subjectId: toCache.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.summary)).toEqual([
      "Detected connection: APP01 → CACHE:6379 (likely Redis)",
      "Ignored suggestion: APP01 → CACHE",
      "Restored suggestion: APP01 → CACHE",
    ]);
  });

  it("VIEWERs cannot review in bulk; ids of another workspace are never touched", async () => {
    const ctx = await ownerContext("Acme");
    const viewer = await memberContext(ctx, "VIEWER");
    const globex = await ownerContext("Globex");
    const { toSql } = await threeSuggestions(ctx);

    await expect(confirmRelationships(viewer, [toSql.id])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ignoreRelationships(viewer, [toSql.id])).rejects.toBeInstanceOf(ForbiddenError);
    expect(await confirmRelationships(globex, [toSql.id])).toBe(0);
    expect(await ignoreRelationships(globex, [toSql.id])).toBe(0);
    expect(await restoreRelationships(globex, [toSql.id])).toBe(0);
    expect(
      (await adminDb().relationship.findUniqueOrThrow({ where: { id: toSql.id } })).status,
    ).toBe("UNCONFIRMED");
    await expect(confirmRelationships(ctx, [])).rejects.toThrow();
  });
});

describe("exclusion rules", () => {
  it("remove the suggestions they explain, block new ones, and give them back when deleted", async () => {
    const ctx = await ownerContext("Acme");
    const { report, backup, toBackup, toSql } = await threeSuggestions(ctx);

    // Backup traffic: process bpcd.exe on port 9102.
    const { id, removed } = await createDiscoveryRule(ctx, {
      port: 9102,
      processName: "BPCD.EXE",
      note: "Backup agent",
    });
    expect(removed).toBe(1);
    expect((await listSuggestions(ctx)).map((s) => s.id)).not.toContain(toBackup.id);
    expect((await listChangesForResource(ctx, backup.id))[0]).toMatchObject({
      actorType: "USER",
      kind: "DELETED",
      summary: "Suggestion removed by an exclusion rule: APP01 → BACKUP",
    });

    await report(); // still excluded on the next report
    expect(await listSuggestions(ctx)).toHaveLength(2);
    expect(await listDiscoveryRules(ctx)).toMatchObject([
      { port: 9102, processName: "BPCD.EXE", resource: null, note: "Backup agent" },
    ]);

    await deleteDiscoveryRule(ctx, id);
    const back = await listSuggestions(ctx);
    expect(back).toHaveLength(3);
    expect(back.find((s) => s.to.id === backup.id)).toBeTruthy();
    expect(back.find((s) => s.id === toSql.id)).toBeTruthy(); // untouched throughout

    const audit = await adminDb().auditEvent.findMany({
      where: { workspaceId: ctx.workspaceId, action: { startsWith: "discovery." } },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => [a.action, a.targetLabel])).toEqual([
      ["discovery.rule_created", "port 9102 · process BPCD.EXE"],
      ["discovery.rule_deleted", "port 9102 · process BPCD.EXE"],
    ]);
  });

  it("a resource rule covers both ends; confirmed relationships are never removed", async () => {
    const ctx = await ownerContext("Acme");
    const { sql, cache, toSql, toCache } = await threeSuggestions(ctx);
    await confirmRelationships(ctx, [toSql.id]);

    const { removed } = await createDiscoveryRule(ctx, { resourceId: sql.id });
    expect(removed).toBe(0); // the only APP01 → SQL01 relationship is confirmed
    expect(
      (await adminDb().relationship.findUniqueOrThrow({ where: { id: toSql.id } })).status,
    ).toBe("CONFIRMED");
    expect((await createDiscoveryRule(ctx, { resourceId: cache.id })).removed).toBe(1);
    expect((await listSuggestions(ctx)).map((s) => s.id)).not.toContain(toCache.id);
  });

  it("validates input, tenancy and role", async () => {
    const ctx = await ownerContext("Acme");
    const viewer = await memberContext(ctx, "VIEWER");
    const globex = await ownerContext("Globex");
    const foreign = await createResource(globex, { name: "G1", type: "SERVER" });

    await expect(createDiscoveryRule(ctx, {})).rejects.toThrow(/at least a port/);
    await expect(createDiscoveryRule(ctx, { port: 70000 })).rejects.toThrow(/between 1 and 65535/);
    await expect(createDiscoveryRule(ctx, { resourceId: foreign.id })).rejects.toBeInstanceOf(
      DiscoveryRuleError,
    );
    await expect(createDiscoveryRule(viewer, { port: 445 })).rejects.toBeInstanceOf(ForbiddenError);

    const { id } = await createDiscoveryRule(ctx, { port: 445 });
    await expect(deleteDiscoveryRule(globex, id)).rejects.toBeInstanceOf(DiscoveryRuleError);
    await expect(deleteDiscoveryRule(viewer, id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listDiscoveryRules(globex)).toEqual([]);
    // The database also refuses a rule without criteria.
    await expect(
      adminDb().discoveryRule.create({ data: { workspaceId: ctx.workspaceId } }),
    ).rejects.toThrow();
  });
});

describe("expiry and incremental discovery", () => {
  it("expires unreviewed agent suggestions not observed for 30 days, and only those", async () => {
    const ctx = await ownerContext("Acme");
    const { toSql, toCache, toBackup } = await threeSuggestions(ctx);
    await confirmRelationships(ctx, [toCache.id]);
    const old = new Date(Date.now() - 31 * 86_400_000);
    await adminDb().relationship.updateMany({
      where: { id: { in: [toSql.id, toCache.id] } },
      data: { lastObservedAt: old },
    });
    // A suggestion made by an import has no observation date: it never expires.
    const a = await createResource(ctx, { name: "web", type: "CONTAINER" });
    const b = await createResource(ctx, { name: "db", type: "CONTAINER" });
    const imported = await adminDb().relationship.create({
      data: {
        workspaceId: ctx.workspaceId,
        fromResourceId: a.id,
        toResourceId: b.id,
        type: "DEPENDS_ON",
        origin: "DETECTED",
        status: "UNCONFIRMED",
      },
    });

    expect((await runRetention()).expiredSuggestions).toBe(1);
    const left = await adminDb().relationship.findMany({ select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([toCache.id, toBackup.id, imported.id].sort());
    expect(
      await adminDb().changeEvent.findFirst({ where: { subjectId: toSql.id, kind: "DELETED" } }),
    ).toMatchObject({ actorType: "SYSTEM", summary: expect.stringMatching(/^Suggestion expired/) });
  });

  it("a new host resolves other agents' earlier connections on its first report", async () => {
    const ctx = await ownerContext("Acme");
    const app = await enrolledAgent(ctx);
    // APP01 talks to 10.0.0.70:8080 — nobody owns that IP yet.
    await app(sampleReport({ connections: [connection("10.0.0.70", 8080)] }));
    expect(await listSuggestions(ctx)).toEqual([]);

    const api = await enrolledAgent(ctx, "machine-api01", "API01");
    await api(
      sampleReport({
        host: { ...sampleReport().host, hostname: "API01", fqdn: "api01.corp.local" },
        interfaces: [{ name: "Ethernet0", addresses: ["10.0.0.70/24"] }],
        connections: [],
      }),
    );
    expect(await listSuggestions(ctx)).toMatchObject([
      { from: { name: "APP01" }, to: { name: "API01" }, evidence: { ports: [8080] } },
    ]);
  });
});
