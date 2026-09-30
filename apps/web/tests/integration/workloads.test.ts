// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { POST as reportRoute } from "@/app/api/agent/v1/report/route";
import type { WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { sampleReport } from "@/server/modules/agents/fixtures";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import { listSuggestions } from "@/server/modules/discovery/discovery";
import { updateResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

/** M16: IIS sites and SQL Server databases reported by the Windows agent. */

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

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function enrolledAgent(ctx: WorkspaceContext, machineId: string, hostname: string) {
  const { token } = await createEnrollmentToken(ctx, { name: machineId, expiresInHours: 24 });
  const res = await enrollRoute(
    post({
      enrollmentToken: token,
      machineId,
      hostname,
      os: "windows",
      osVersion: "10",
      arch: "amd64",
      agentVersion: "0.2.0",
    }),
  );
  const body = (await res.json()) as { agentSecret: string; features: string[] };
  expect(body.features).toEqual(["workloads", "workloads-linux", "hypervisors"]);
  return (report: ReportV1) =>
    reportRoute(post(report, { authorization: `Bearer ${body.agentSecret}` }));
}

const web01 = (workloads: ReportV1["workloads"], connections: ReportV1["connections"] = []) =>
  sampleReport({
    host: { ...sampleReport().host, hostname: "WEB01", fqdn: "web01.corp.local" },
    interfaces: [{ name: "Ethernet0", addresses: ["10.0.0.80/24"] }],
    connections,
    workloads,
  });

const at = "2026-09-29T10:05:00Z";
const portal = {
  name: "Portal",
  bindings: [{ protocol: "https" as const, port: 443, host: "portal.corp.local" }],
};
const intranet = { name: "Intranet", bindings: [{ protocol: "http" as const, port: 8080 }] };

describe("windows workloads", () => {
  it("creates sites and databases on the host, and reconciles each kind on its own", async () => {
    const ctx = await ownerContext("Acme");
    const report = await enrolledAgent(ctx, "machine-web01", "WEB01");

    const res = await report(
      web01({
        collectedAt: at,
        iisSites: [portal, intranet],
        sqlDatabases: [
          { instance: "MSSQLSERVER", name: "Customers" },
          { instance: "MSSQLSERVER", name: "tempdb" },
        ],
      }),
    );
    expect(res.status).toBe(202);
    expect(((await res.json()) as { features: string[] }).features).toEqual([
      "workloads",
      "workloads-linux",
      "hypervisors",
    ]);

    const resources = await adminDb().resource.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { name: "asc" },
      select: { name: true, type: true, status: true, sourceRef: true, metadata: true },
    });
    expect(resources.map((r) => [r.name, r.type, r.status])).toEqual([
      ["Customers (WEB01)", "DATABASE", "DISCOVERED"],
      ["Intranet (WEB01)", "APPLICATION", "DISCOVERED"],
      ["Portal (WEB01)", "APPLICATION", "DISCOVERED"],
      ["WEB01", "SERVER", "DISCOVERED"],
    ]);
    expect(resources.find((r) => r.name === "Portal (WEB01)")!.metadata).toEqual({
      fqdn: "portal.corp.local",
      ports: [443],
    });
    const rels = await adminDb().relationship.findMany({
      include: { from: true, to: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rels.map((r) => [r.from.name, r.type, r.to.name, r.status, r.origin]).sort()).toEqual(
      [
        ["Customers (WEB01)", "RUNS_ON", "WEB01", "CONFIRMED", "DETECTED"],
        ["Intranet (WEB01)", "RUNS_ON", "WEB01", "CONFIRMED", "DETECTED"],
        ["Portal (WEB01)", "RUNS_ON", "WEB01", "CONFIRMED", "DETECTED"],
      ].sort(),
    );

    // A person edits the site (the form has no ports): discovery's ports stay.
    const portalRow = await adminDb().resource.findFirstOrThrow({
      where: { name: "Portal (WEB01)" },
    });
    await updateResource(ctx, portalRow.id, {
      name: "Portal (WEB01)",
      type: "APPLICATION",
      notes: "Customer portal",
      metadata: { fqdn: "portal.corp.local" },
    });
    expect(
      (await adminDb().resource.findUniqueOrThrow({ where: { id: portalRow.id } })).metadata,
    ).toEqual({ fqdn: "portal.corp.local", ports: [443] });

    // The Intranet site is removed; databases were not collected this time.
    await report(web01({ collectedAt: at, iisSites: [portal] }));
    const status = Object.fromEntries(
      (
        await adminDb().resource.findMany({
          where: { workspaceId: ctx.workspaceId },
          select: { name: true, status: true },
        })
      ).map((r) => [r.name, r.status]),
    );
    expect(status).toMatchObject({
      "Intranet (WEB01)": "STALE",
      "Portal (WEB01)": "ACTIVE", // a person edited it: human-owned status
      "Customers (WEB01)": "DISCOVERED", // an absent kind is never reconciled
    });

    // A report without workloads (older agent) changes nothing.
    expect((await report(web01(undefined))).status).toBe(202);
    expect(await adminDb().resource.count({ where: { workspaceId: ctx.workspaceId } })).toBe(4);
  });

  it("attributes a connection to the site bound to that port, as a suggestion", async () => {
    const ctx = await ownerContext("Acme");
    const web = await enrolledAgent(ctx, "machine-web01", "WEB01");
    await web(web01({ collectedAt: at, iisSites: [portal, intranet] }));

    const app = await enrolledAgent(ctx, "machine-app01", "APP01");
    const outbound = (port: number): ReportV1["connections"][number] => ({
      proto: "tcp",
      direction: "outbound",
      localPort: 0,
      remoteAddress: "10.0.0.80",
      remotePort: port,
      process: { name: "w3wp.exe" },
      count: 10,
      firstSeen: "2026-09-29T10:00:00Z",
      lastSeen: "2026-09-29T10:04:30Z",
    });
    await app(sampleReport({ connections: [outbound(443), outbound(3389)] }));

    const suggestions = await listSuggestions(ctx);
    expect(suggestions.map((s) => [s.from.name, s.to.name, s.evidence.ports]).sort()).toEqual(
      [
        ["APP01", "Portal (WEB01)", [443]], // the only site on 443
        ["APP01", "WEB01", [3389]], // no site on that port: the server itself
      ].sort(),
    );
  });

  it("rejects unexpected workload fields (data minimisation)", async () => {
    const ctx = await ownerContext("Acme");
    const report = await enrolledAgent(ctx, "machine-web01", "WEB01");
    const bad = web01({
      collectedAt: at,
      iisSites: [{ ...portal, physicalPath: "C:\\inetpub\\portal" } as never],
    });
    expect((await report(bad)).status).toBe(422);
  });
});

describe("linux workloads (M20)", () => {
  it("imports nginx / Apache sites and PostgreSQL / MySQL databases on the Linux host", async () => {
    const ctx = await ownerContext("Acme");
    const report = await enrolledAgent(ctx, "machine-lin01", "LIN01");
    const lin01 = (workloads: ReportV1["workloads"]) =>
      sampleReport({
        host: { ...sampleReport().host, hostname: "LIN01", os: "linux", osName: "Ubuntu 24.04" },
        interfaces: [{ name: "eth0", addresses: ["10.0.0.90/24"] }],
        connections: [],
        workloads,
      });
    const res = await report(
      lin01({
        collectedAt: at,
        nginxSites: [
          {
            name: "shop.example.com",
            bindings: [{ protocol: "https", port: 443, host: "shop.example.com" }],
          },
        ],
        apacheSites: [],
        postgresDatabases: [
          { instance: "5432", name: "orders" },
          { instance: "5432", name: "postgres" },
        ],
        mysqlDatabases: [{ instance: "default", name: "wordpress" }],
      }),
    );
    expect(res.status).toBe(202);
    const rows = await adminDb().resource.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { name: "asc" },
      select: { name: true, type: true, tags: true, sourceRef: true },
    });
    expect(rows.map((r) => [r.name, r.type, r.tags])).toEqual([
      ["LIN01", "SERVER", []],
      ["orders (LIN01)", "DATABASE", ["postgresql"]],
      ["shop.example.com (LIN01)", "APPLICATION", ["nginx"]],
      ["wordpress (LIN01)", "DATABASE", ["mysql"]],
    ]);
    expect(rows.find((r) => r.name === "orders (LIN01)")!.sourceRef).toMatch(
      /^collector:.+:postgresql$/,
    );
    const runsOn = await adminDb().relationship.count({
      where: { type: "RUNS_ON", status: "CONFIRMED" },
    });
    expect(runsOn).toBe(3);
  });
});
