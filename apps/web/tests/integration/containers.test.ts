// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { POST as reportRoute } from "@/app/api/agent/v1/report/route";
import type { WorkspaceContext } from "@/server/authz";
import { createEnrollmentToken } from "@/server/modules/agents/agents";
import { sampleReport } from "@/server/modules/agents/fixtures";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

/** M25: Docker containers reported by the Linux agent. */

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
      os: "linux",
      osVersion: "12",
      arch: "amd64",
      agentVersion: "0.6.0",
    }),
  );
  const body = (await res.json()) as { agentSecret: string; features: string[] };
  expect(body.features).toContain("containers");
  return (report: ReportV1) =>
    reportRoute(post(report, { authorization: `Bearer ${body.agentSecret}` }));
}

type Containers = NonNullable<NonNullable<ReportV1["workloads"]>["containers"]>;
const at = "2026-10-01T10:05:00Z";
const docker01 = (containers: Containers, connections: ReportV1["connections"] = []) =>
  sampleReport({
    host: { ...sampleReport().host, hostname: "DOCKER01", os: "linux" },
    interfaces: [{ name: "eth0", addresses: ["10.0.0.50/24"] }],
    connections,
    workloads: { collectedAt: at, containers },
  });

const stack: Containers = [
  {
    name: "shop-db-1",
    image: "postgres:16-alpine",
    state: "running",
    ports: [{ port: 5432, targetPort: 5432, protocol: "tcp" }],
    project: "shop",
    service: "db",
  },
  {
    name: "shop-web-1",
    image: "ghcr.io/acme/shop:1.4.2",
    state: "running",
    ports: [],
    project: "shop",
    service: "web",
    dependsOn: ["db"],
    hosts: ["shop.example.com"],
  },
  {
    name: "traefik",
    image: "traefik:v3.1",
    state: "running",
    ports: [
      { port: 80, targetPort: 80, protocol: "tcp" },
      { port: 443, targetPort: 443, protocol: "tcp" },
    ],
  },
];

const graph = async (workspaceId: string) =>
  (
    await adminDb().relationship.findMany({
      where: { workspaceId },
      include: { from: true, to: true },
    })
  )
    .map((r) => `${r.from.name} ${r.type} ${r.to.name} ${r.status}`)
    .sort();

describe("docker containers", () => {
  it("imports what runs inside, Compose dependencies and reverse-proxy routes", async () => {
    const ctx = await ownerContext("Acme");
    const report = await enrolledAgent(ctx, "machine-docker01", "DOCKER01");
    expect((await report(docker01(stack))).status).toBe(202);

    const resources = await adminDb().resource.findMany({
      where: { workspaceId: ctx.workspaceId },
    });
    const byName = new Map(resources.map((r) => [r.name, r]));
    expect(byName.get("shop-db (DOCKER01)")).toMatchObject({
      type: "DATABASE",
      status: "DISCOVERED",
    });
    expect(byName.get("shop-db (DOCKER01)")!.tags).toEqual(
      expect.arrayContaining(["docker", "postgresql", "compose:shop"]),
    );
    expect(byName.get("shop-db (DOCKER01)")!.metadata).toMatchObject({
      ports: [5432],
      version: "16-alpine",
    });
    expect(byName.get("shop-web (DOCKER01)")!.type).toBe("CONTAINER");
    expect(byName.get("shop.example.com")!.type).toBe("DOMAIN");

    expect(await graph(ctx.workspaceId)).toEqual([
      "shop-db (DOCKER01) RUNS_ON DOCKER01 CONFIRMED",
      "shop-web (DOCKER01) DEPENDS_ON shop-db (DOCKER01) UNCONFIRMED",
      "shop-web (DOCKER01) EXPOSED_THROUGH traefik (DOCKER01) CONFIRMED",
      "shop-web (DOCKER01) RUNS_ON DOCKER01 CONFIRMED",
      "shop.example.com DEPENDS_ON shop-web (DOCKER01) CONFIRMED",
      "traefik (DOCKER01) RUNS_ON DOCKER01 CONFIRMED",
    ]);

    // A redeploy recreates the containers (new names / ids): same resources.
    const recreated = stack.map((c) => ({ ...c, name: c.name.replace("-1", "-2") }));
    expect((await report(docker01(recreated))).status).toBe(202);
    const after = await adminDb().resource.findMany({ where: { workspaceId: ctx.workspaceId } });
    expect(after).toHaveLength(resources.length);

    // The database container removed: stale, not deleted.
    expect((await report(docker01(recreated.filter((c) => c.service !== "db")))).status).toBe(202);
    const db = await adminDb().resource.findFirstOrThrow({ where: { name: "shop-db (DOCKER01)" } });
    expect(db.status).toBe("STALE");
  });

  it("links reverse proxies to what they forward to (suggestions)", async () => {
    const ctx = await ownerContext("Acme");
    // APP01 (10.0.0.31) reports with its own agent.
    const app01 = await enrolledAgent(ctx, "machine-app01", "APP01");
    expect(
      (
        await app01(
          sampleReport({
            host: { ...sampleReport().host, hostname: "APP01" },
            interfaces: [{ name: "eth0", addresses: ["10.0.0.31/24"] }],
            connections: [],
          }),
        )
      ).status,
    ).toBe(202);

    const report = await enrolledAgent(ctx, "machine-docker01", "DOCKER01");
    const res = await report(
      sampleReport({
        host: { ...sampleReport().host, hostname: "DOCKER01", os: "linux" },
        interfaces: [{ name: "eth0", addresses: ["10.0.0.50/24"] }],
        connections: [],
        workloads: {
          collectedAt: at,
          containers: [
            {
              name: "api-1",
              image: "ghcr.io/acme/api:2",
              state: "running",
              ports: [{ port: 3000, targetPort: 3000, protocol: "tcp" }],
            },
          ],
          nginxSites: [
            {
              name: "api.example.com",
              bindings: [{ protocol: "https", port: 443, host: "api.example.com" }],
              upstreams: [
                { host: "127.0.0.1", port: 3000 },
                { host: "127.0.0.1", port: 9999 }, // nothing publishes it: skipped
              ],
            },
          ],
          haproxySites: [
            {
              name: "web",
              bindings: [{ protocol: "http", port: 80 }],
              upstreams: [
                { host: "10.0.0.31", port: 8080 },
                { host: "10.9.9.9", port: 8080 }, // unknown: skipped
              ],
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(202);
    const rels = (await graph(ctx.workspaceId)).filter((r) => r.includes("DEPENDS_ON"));
    expect(rels).toEqual([
      "api.example.com (DOCKER01) DEPENDS_ON api-1 (DOCKER01) UNCONFIRMED",
      "web (DOCKER01) DEPENDS_ON APP01 UNCONFIRMED",
    ]);
  });

  it("kubernetes: nodes (same machine as their agent), workloads, ingress hosts", async () => {
    const ctx = await ownerContext("Acme");
    const node1 = await enrolledAgent(ctx, "machine-node1", "node1");
    const res = await node1(
      sampleReport({
        host: { ...sampleReport().host, hostname: "node1", os: "linux" },
        interfaces: [{ name: "eth0", addresses: ["10.0.1.11/24"] }],
        connections: [],
        kubernetes: {
          cluster: "prod",
          collectedAt: at,
          nodes: [{ name: "node1", ips: ["10.0.1.11"], version: "v1.31.2" }],
          workloads: [
            {
              namespace: "shop",
              name: "web",
              kind: "Deployment",
              images: ["ghcr.io/acme/shop:1.4.2"],
              replicas: 2,
              ready: 2,
              nodes: ["node1"],
              services: [
                { name: "web", type: "LoadBalancer", ports: [80], externalIps: ["203.0.113.40"] },
              ],
              hosts: ["shop.example.com"],
            },
            {
              namespace: "shop",
              name: "db",
              kind: "StatefulSet",
              images: ["postgres:16"],
              nodes: ["node1"],
              services: [{ name: "db", type: "ClusterIP", ports: [5432] }],
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(202);
    const resources = await adminDb().resource.findMany({
      where: { workspaceId: ctx.workspaceId },
    });
    expect(resources.map((r) => [r.name, r.type]).sort()).toEqual([
      ["node1", "SERVER"], // the agent's host, not a second "node1"
      ["shop.example.com", "DOMAIN"],
      ["shop/db", "DATABASE"],
      ["shop/web", "APPLICATION"],
    ]);
    expect(resources.find((r) => r.name === "shop/web")!.metadata).toMatchObject({
      ipAddresses: ["203.0.113.40"],
      ports: [80],
    });
    expect(await graph(ctx.workspaceId)).toEqual([
      "shop.example.com DEPENDS_ON shop/web CONFIRMED",
      "shop/db RUNS_ON node1 CONFIRMED",
      "shop/web RUNS_ON node1 CONFIRMED",
    ]);
  });
});
