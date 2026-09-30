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

/** M24: hypervisor inventories from agent-side collectors (ADR-035). */

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
      agentVersion: "0.5.0",
    }),
  );
  const body = (await res.json()) as { agentSecret: string; features: string[] };
  expect(body.features).toContain("hypervisors");
  return (report: ReportV1) =>
    reportRoute(post(report, { authorization: `Bearer ${body.agentSecret}` }));
}

const at = "2026-09-30T10:05:00Z";
const reportFrom = (hostname: string, ip: string, hypervisors: ReportV1["hypervisors"]) =>
  sampleReport({
    host: { ...sampleReport().host, hostname },
    interfaces: [{ name: "Ethernet0", addresses: [`${ip}/24`] }],
    connections: [],
    hypervisors,
  });

const graph = async (workspaceId: string) => {
  const rels = await adminDb().relationship.findMany({
    where: { workspaceId },
    include: { from: true, to: true },
  });
  return rels.map((r) => `${r.from.name} ${r.type} ${r.to.name} ${r.status}`).sort();
};

describe("hypervisor collectors", () => {
  it("vCenter: hosts and VMs with placement; a guest running an agent is the same machine", async () => {
    const ctx = await ownerContext("Acme");
    // APP01 already reports with its own agent.
    const app01 = await enrolledAgent(ctx, "machine-app01", "APP01");
    expect((await app01(reportFrom("APP01", "10.0.0.23", undefined))).status).toBe(202);

    const collector = await enrolledAgent(ctx, "machine-tools", "TOOLS01");
    const vcenter = (vms: NonNullable<ReportV1["hypervisors"]>[number]["vms"]) =>
      collector(
        reportFrom("TOOLS01", "10.0.0.5", [
          {
            source: "vcenter",
            collectedAt: at,
            hosts: [
              { id: "host-21", name: "esx01.corp.local", cluster: "Prod", status: "connected" },
            ],
            vms,
          },
        ]),
      );
    const res = await vcenter([
      // VM named differently from its guest: matched by the guest host name.
      {
        id: "vm-42",
        name: "app01-prod",
        host: "host-21",
        status: "poweredOn",
        cpus: 4,
        memoryMb: 8192,
        hostname: "app01.corp.local",
        ips: ["10.0.0.23"],
      },
      { id: "vm-43", name: "db01", host: "host-21", status: "poweredOn", ips: ["10.0.0.30"] },
      { id: "vm-7", name: "tpl-win2022", host: "host-21", template: true },
    ]);
    expect(res.status).toBe(202);

    const resources = await adminDb().resource.findMany({
      where: { workspaceId: ctx.workspaceId },
    });
    const rows = resources
      .map((r) => [r.name, r.type, r.source])
      .sort((a, b) => a[0]!.localeCompare(b[0]!));
    expect(rows).toEqual([
      ["APP01", "SERVER", "AGENT"], // not duplicated as a VM
      ["db01", "VM", "IMPORT"],
      ["esx01.corp.local", "SERVER", "IMPORT"],
      ["TOOLS01", "SERVER", "AGENT"],
    ]);
    expect(await graph(ctx.workspaceId)).toEqual([
      "esx01.corp.local HOSTS APP01 CONFIRMED",
      "esx01.corp.local HOSTS db01 CONFIRMED",
    ]);

    // db01 deleted in vCenter: stale on the next collection (reconciled per platform).
    await vcenter([
      { id: "vm-42", name: "app01-prod", host: "host-21", hostname: "app01.corp.local" },
    ]);
    const db01 = await adminDb().resource.findFirstOrThrow({ where: { name: "db01" } });
    expect(db01.status).toBe("STALE");
  });

  it("Hyper-V: guests hang from the reporting agent's own host", async () => {
    const ctx = await ownerContext("Acme");
    const hv01 = await enrolledAgent(ctx, "machine-hv01", "HV01");
    const res = await hv01(
      reportFrom("HV01", "10.0.0.2", [
        {
          source: "hyperv",
          collectedAt: at,
          hosts: [],
          vms: [
            {
              id: "3f2a6c1e-8a55-4c55-9b1f-2d9a2b0f7c11",
              name: "DC01",
              status: "Running",
              ips: ["10.0.0.10"],
            },
          ],
        },
      ]),
    );
    expect(res.status).toBe(202);
    expect(await graph(ctx.workspaceId)).toEqual(["HV01 HOSTS DC01 CONFIRMED"]);
  });

  it("rejects fields outside the contract (data minimisation)", async () => {
    const ctx = await ownerContext("Acme");
    const agent = await enrolledAgent(ctx, "machine-x", "X01");
    const res = await agent(
      reportFrom("X01", "10.0.0.9", [
        {
          source: "vcenter",
          collectedAt: at,
          hosts: [],
          vms: [{ id: "vm-1", name: "a", password: "nope" } as never],
        },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
