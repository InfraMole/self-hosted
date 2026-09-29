// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { layoutGraph } from "@/components/map/layout";
import type { WorkspaceContext } from "@/server/authz";
import { sampleReport } from "@/server/modules/agents/fixtures";
import { ingestReport } from "@/server/modules/agents/ingestion";
import {
  countSuggestions,
  listSuggestions,
  refreshDetectedRelationships,
} from "@/server/modules/discovery/discovery";
import { getResourceImpact } from "@/server/modules/impact/impact";
import { getWorkspaceGraph } from "@/server/modules/map/map";
import { confirmRelationships } from "@/server/modules/relationships/relationships";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "../integration/helpers";

/**
 * Load test (M15, ADR-027): a workspace of N servers, one agent each, a
 * three-tier topology (apps → 2 databases + a domain controller; databases →
 * a domain controller). Measures the server side of first-day discovery, the
 * inbox, bulk confirm, the map payload, impact and one agent report.
 * Run with `pnpm test:load`; results are printed as a table.
 */

const SIZES = [250, 1000, 2000];
const results: Record<string, string | number>[] = [];
afterAll(() => {
  console.table(results);
  return adminDb().$disconnect();
});

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - start)];
}

const ip = (i: number) =>
  `10.${Math.floor(i / 65_536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`;

async function seed(n: number) {
  await resetDatabase();
  const user = await createTestUser(`load ${n}`);
  const ws = await createWorkspace(user.id, { name: `Load ${n}` });
  const ctx = (await findWorkspaceContextForUser(user.id, ws.slug)) as WorkspaceContext;
  const db = adminDb();

  const cores = Math.max(2, Math.round(n * 0.02));
  const dbs = Math.max(2, Math.round(n * 0.15));
  const role = (i: number) => (i < cores ? "DC" : i < cores + dbs ? "SQL" : "APP");
  const agentIds = Array.from({ length: n }, () => randomUUID());
  const resources = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(),
    externalId: agentIds[i]!,
    workspaceId: ctx.workspaceId,
    name: `${role(i)}-${String(i).padStart(5, "0")}`,
    type: "SERVER" as const,
    status: "DISCOVERED" as const,
    source: "AGENT" as const,
    metadata: { ipAddresses: [ip(i + 1)] },
  }));
  for (let i = 0; i < n; i += 1000)
    await db.resource.createMany({ data: resources.slice(i, i + 1000) });

  const agents = resources.map((r, i) => ({
    id: agentIds[i]!,
    workspaceId: ctx.workspaceId,
    resourceId: r.id,
    machineId: `machine-${i}`,
    hostname: r.name,
    os: "windows",
    osVersion: "10",
    arch: "amd64",
    agentVersion: "0.1.0",
    secretHash: randomUUID(),
    secretPrefix: "x",
    lastSeenAt: new Date(),
  }));
  for (let i = 0; i < n; i += 1000) await db.agent.createMany({ data: agents.slice(i, i + 1000) });

  // Outbound connections of each host, as its agent would have aggregated them.
  const now = new Date();
  const targets = (i: number): [number, number][] => {
    const dc = (i % cores) as number;
    if (role(i) === "DC") return [];
    if (role(i) === "SQL") return [[dc, 389]];
    const sqlA = cores + (i % dbs);
    const sqlB = cores + ((i * 7) % dbs);
    return [
      [sqlA, 1433],
      ...(sqlB !== sqlA ? ([[sqlB, 1433]] as [number, number][]) : []),
      [dc, 389],
    ];
  };
  const facts = resources.flatMap((r, i) =>
    targets(i).map(([t, port]) => ({
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      agentId: agents[i]!.id,
      sourceResourceId: r.id,
      direction: "OUTBOUND" as const,
      remoteIp: ip(t + 1),
      port,
      processName: port === 1433 ? "w3wp.exe" : "lsass.exe",
      sampleCount: 20,
      reportCount: 2,
      firstSeenAt: now,
      lastSeenAt: now,
    })),
  );
  for (let i = 0; i < facts.length; i += 2000)
    await db.connectionFact.createMany({ data: facts.slice(i, i + 2000) });

  return { ctx, resources, agents, facts, targets, dcId: resources[0]!.id };
}

describe.each(SIZES)("%i servers", (n) => {
  it("stays usable", async () => {
    const { ctx, resources, agents, facts, targets, dcId } = await seed(n);
    const row: Record<string, string | number> = { servers: n, connections: facts.length };

    // 1. First-day discovery: every connection becomes a suggestion.
    const [first, discoverMs] = await time(() => refreshDetectedRelationships(ctx.workspaceId));
    row["discover (full) ms"] = discoverMs;
    row.suggestions = await countSuggestions(ctx);
    expect(first.created).toBe(row.suggestions);

    // 2. The inbox.
    const [inbox, inboxMs] = await time(() => listSuggestions(ctx));
    row["inbox ms"] = inboxMs;

    // 3. Bulk confirm, 1,000 at a time.
    let confirmMs = 0;
    for (;;) {
      const page = await listSuggestions(ctx);
      if (page.length === 0) break;
      const [, ms] = await time(() =>
        confirmRelationships(
          ctx,
          page.map((s) => s.id),
          { useSuggestedType: true },
        ),
      );
      confirmMs += ms;
    }
    row["confirm all ms"] = confirmMs;
    expect(inbox.length).toBe(Math.min(Number(row.suggestions), 1000));

    // 4. Steady state: a full re-plan only refreshes evidence.
    const [, steadyMs] = await time(() => refreshDetectedRelationships(ctx.workspaceId));
    row["re-plan (full) ms"] = steadyMs;

    // 5. One agent report (the common case: no IP change → incremental).
    const i = n - 1;
    const agent = await adminDb().agent.findUniqueOrThrow({ where: { id: agents[i]!.id } });
    const report = sampleReport({
      host: { ...sampleReport().host, hostname: resources[i]!.name, fqdn: undefined },
      interfaces: [{ name: "Ethernet0", addresses: [`${ip(i + 1)}/16`] }],
      connections: targets(i).map(([t, port]) => ({
        proto: "tcp" as const,
        direction: "outbound" as const,
        localPort: 0,
        remoteAddress: ip(t + 1),
        remotePort: port,
        process: { name: "w3wp.exe" },
        count: 10,
        firstSeen: new Date(Date.now() - 300_000).toISOString(),
        lastSeen: new Date().toISOString(),
      })),
    });
    const [, reportMs] = await time(() =>
      ingestReport(agent, report, { ip: "10.9.9.9", bytes: 4000 }),
    );
    row["agent report ms"] = reportMs;

    // 6. Map payload.
    const [graph, mapMs] = await time(() => getWorkspaceGraph(ctx));
    row["map data ms"] = mapMs;
    row["map KB"] = Math.round(JSON.stringify(graph).length / 1024);
    row.nodes = graph.nodes.length;
    row.edges = graph.edges.length;
    // The map's layout runs in the browser; same code, same engine (V8).
    const [, layoutMs] = await time(async () =>
      layoutGraph(
        graph.nodes.map((node) => node.id),
        graph.edges,
      ),
    );
    row["layout ms"] = layoutMs;

    // 7. Impact of a domain controller (the widest blast radius).
    const [impact, impactMs] = await time(() => getResourceImpact(ctx, dcId));
    row["impact ms"] = impactMs;
    row.affected = impact?.affected.length ?? 0;

    results.push(row);
    process.stdout.write(`LOAD ${JSON.stringify(row)}` + String.fromCharCode(10));
    expect(graph.nodes.length).toBe(n); // the map must show every server
    expect(impact).not.toBeNull();
  });
});
