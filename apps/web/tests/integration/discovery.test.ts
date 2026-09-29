// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { POST as reportRoute } from "@/app/api/agent/v1/report/route";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { sampleReport } from "@/server/modules/agents/fixtures";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import { listChangesForResource } from "@/server/modules/changes/changes";
import {
  countSuggestions,
  getHostDiscovery,
  listSuggestions,
  refreshDetectedRelationships,
} from "@/server/modules/discovery/discovery";
import {
  confirmRelationship,
  ignoreRelationship,
} from "@/server/modules/relationships/relationships";
import { createResource } from "@/server/modules/resources/resources";
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

async function enrolledAgent(ctx: WorkspaceContext, machineId = "machine-app01") {
  const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
  const res = await enrollRoute(
    post({
      enrollmentToken: token,
      machineId,
      hostname: "APP01",
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
  count = 10,
): ReportV1["connections"][number] => ({
  proto: "tcp",
  direction: "outbound",
  localPort: 0,
  remoteAddress,
  remotePort,
  process: { name: "w3wp.exe" },
  count,
  firstSeen: "2026-09-28T10:00:00Z",
  lastSeen: "2026-09-28T10:04:30Z",
});

describe("discover → suggest", () => {
  it("turns an observed connection to a known resource into ONE detected suggestion with evidence", async () => {
    const ctx = await ownerContext("Acme");
    const sql = await createResource(ctx, {
      name: "SQL01",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.40"] },
    });
    const report = await enrolledAgent(ctx);

    expect((await report()).status).toBe(202); // fixture: APP01 -> 10.0.0.40:1433 x10
    let [s, ...rest] = await listSuggestions(ctx);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      type: "CONNECTS_TO",
      origin: "DETECTED",
      from: { name: "APP01" },
      to: { id: sql.id },
      evidence: {
        ports: [1433],
        protocols: ["MSSQL"],
        processes: ["w3wp.exe"],
        samples: 10,
        suggestedType: "USES_DATABASE",
      },
    });

    // Repeated reports refresh evidence; they never duplicate the suggestion.
    await report();
    [s, ...rest] = await listSuggestions(ctx);
    expect(rest).toEqual([]);
    expect(s!.evidence.samples).toBe(20);
    expect(await countSuggestions(ctx)).toBe(1);

    const events = await listChangesForResource(ctx, sql.id);
    expect(events[0]).toMatchObject({
      actorType: "AGENT",
      kind: "DISCOVERED",
      summary: "Detected connection: APP01 → SQL01:1433 (likely MSSQL)",
    });
  });

  it("requires minimum evidence and keeps unknown endpoints until a resource claims the IP", async () => {
    const ctx = await ownerContext("Acme");
    const report = await enrolledAgent(ctx);
    await createResource(ctx, {
      name: "Blip",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.41"] },
    });
    await report(
      sampleReport({
        connections: [connection("52.1.2.3", 443), connection("10.0.0.41", 5432, 1)],
      }),
    );
    expect(await listSuggestions(ctx)).toEqual([]); // unknown IP + 1-sample connection

    const host = (await adminDb().resource.findFirstOrThrow({ where: { source: "AGENT" } })).id;
    const discovery = await getHostDiscovery(ctx, host);
    expect(discovery!.unknownEndpoints.map((u) => `${u.remoteIp}:${u.port}`)).toEqual([
      "52.1.2.3:443",
    ]);
    expect(discovery!.listeners.map((l) => l.port)).toEqual([443]);

    // A human documents the endpoint -> it becomes a suggestion without a new report.
    await createResource(ctx, {
      name: "Payments API",
      type: "EXTERNAL_SERVICE",
      metadata: { ipAddresses: ["52.1.2.3"] },
    });
    await refreshDetectedRelationships(ctx.workspaceId);
    const [s] = await listSuggestions(ctx);
    expect(s).toMatchObject({ to: { name: "Payments API" }, evidence: { protocols: ["HTTPS"] } });
    expect((await getHostDiscovery(ctx, host))!.unknownEndpoints).toEqual([]);
  });

  it("never resolves IPs against another workspace's resources", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    await createResource(globex, {
      name: "Globex DB",
      type: "DATABASE",
      metadata: { ipAddresses: ["10.0.0.40"] },
    });
    const report = await enrolledAgent(acme);
    await report();
    expect(await listSuggestions(acme)).toEqual([]);
    expect(await listSuggestions(globex)).toEqual([]);
    expect(await adminDb().relationship.count()).toBe(0);
  });

  it("does not suggest when the pair is already documented; adds evidence instead", async () => {
    const ctx = await ownerContext("Acme");
    const sql = await createResource(ctx, {
      name: "SQL01",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.40"] },
    });
    const report = await enrolledAgent(ctx);
    await report();
    const host = await adminDb().resource.findFirstOrThrow({ where: { source: "AGENT" } });
    const [s] = await listSuggestions(ctx);
    await confirmRelationship(ctx, s!.id, { type: "USES_DATABASE", note: "Customer DB" });

    await report();
    expect(await listSuggestions(ctx)).toEqual([]);
    const rel = await adminDb().relationship.findFirstOrThrow({
      where: { fromResourceId: host.id, toResourceId: sql.id },
      include: { evidence: true },
    });
    expect(rel).toMatchObject({
      type: "USES_DATABASE",
      status: "CONFIRMED",
      origin: "DETECTED",
      note: "Customer DB",
    });
    expect(rel.evidence[0]!.sampleCount).toBe(20);
  });
});

describe("reviewing suggestions", () => {
  it("confirm records who and what; ignored pairs are never suggested again", async () => {
    const ctx = await ownerContext("Acme");
    const sql = await createResource(ctx, {
      name: "SQL01",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.40"] },
    });
    await createResource(ctx, {
      name: "Cache",
      type: "CONTAINER",
      metadata: { ipAddresses: ["10.0.0.50"] },
    });
    const report = await enrolledAgent(ctx);
    await report(
      sampleReport({ connections: [connection("10.0.0.40", 1433), connection("10.0.0.50", 6379)] }),
    );

    const suggestions = await listSuggestions(ctx);
    expect(suggestions).toHaveLength(2);
    const toSql = suggestions.find((s) => s.to.id === sql.id)!;
    const toCache = suggestions.find((s) => s.to.id !== sql.id)!;

    await confirmRelationship(ctx, toSql.id, { type: "USES_DATABASE" });
    await ignoreRelationship(ctx, toCache.id);
    await expect(ignoreRelationship(ctx, toCache.id)).rejects.toThrow(/already reviewed/);

    await report(
      sampleReport({ connections: [connection("10.0.0.40", 1433), connection("10.0.0.50", 6379)] }),
    );
    expect(await listSuggestions(ctx)).toEqual([]);
    expect(
      (await adminDb().relationship.findUniqueOrThrow({ where: { id: toCache.id } })).status,
    ).toBe("IGNORED");

    const events = await listChangesForResource(ctx, sql.id);
    expect(events[0]).toMatchObject({
      actorType: "USER",
      kind: "CONFIRMED",
      summary: "Confirmed relationship: APP01 uses database SQL01",
    });
  });

  it("VIEWER cannot review; other workspaces cannot see or review", async () => {
    const ctx = await ownerContext("Acme");
    const viewer = await memberContext(ctx, "VIEWER");
    const globex = await ownerContext("Globex");
    await createResource(ctx, {
      name: "SQL01",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.40"] },
    });
    const report = await enrolledAgent(ctx);
    await report();
    const [s] = await listSuggestions(ctx);

    expect(await listSuggestions(viewer)).toHaveLength(1);
    await expect(confirmRelationship(viewer, s!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ignoreRelationship(viewer, s!.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listSuggestions(globex)).toEqual([]);
    await expect(confirmRelationship(globex, s!.id)).rejects.toThrow(/not found/i);
  });
});
