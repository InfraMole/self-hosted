// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as enrollRoute } from "@/app/api/agent/v1/enroll/route";
import { POST as reportRoute } from "@/app/api/agent/v1/report/route";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import {
  createEnrollmentToken,
  listAgents,
  listEnrollmentTokens,
  revokeAgent,
  revokeEnrollmentToken,
} from "@/server/modules/agents/agents";
import { sampleReport } from "@/server/modules/agents/fixtures";
import { listChangesForResource, listWorkspaceChanges } from "@/server/modules/changes/changes";
import { listRelationshipsForResource } from "@/server/modules/relationships/relationships";
import { listResources } from "@/server/modules/resources/resources";
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

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const enrollBody = (token: string, machineId = "machine-0001") => ({
  enrollmentToken: token,
  machineId,
  hostname: "APP01",
  os: "windows",
  osVersion: "10.0.20348",
  arch: "amd64",
  agentVersion: "0.1.0",
});

async function enroll(token: string, machineId?: string) {
  const res = await enrollRoute(json(enrollBody(token, machineId)));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const report = (secret: string, body: unknown = sampleReport()) =>
  reportRoute(json(body, { authorization: `Bearer ${secret}` }));

describe("enrollment tokens", () => {
  it("only ADMIN+ can manage tokens; plaintext is returned once and never stored", async () => {
    const owner = await ownerContext("Acme");
    const member = await memberContext(owner, "MEMBER");
    await expect(
      createEnrollmentToken(member, { name: "x", expiresInHours: 24 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const created = await createEnrollmentToken(owner, { name: "Servers", expiresInHours: 24 });
    expect(created.token).toMatch(/^dmp_enr_/);
    const row = await adminDb().enrollmentToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect((await listEnrollmentTokens(owner))[0]).toMatchObject({
      name: "Servers",
      state: "active",
    });
  });

  it("rejects invalid, revoked, expired and exhausted tokens with 401", async () => {
    const ctx = await ownerContext("Acme");
    expect((await enroll("dmp_enr_" + "a".repeat(43))).status).toBe(401);

    const revoked = await createEnrollmentToken(ctx, { name: "r", expiresInHours: 1 });
    await revokeEnrollmentToken(ctx, revoked.id);
    expect((await enroll(revoked.token)).status).toBe(401);

    const expired = await createEnrollmentToken(ctx, { name: "e", expiresInHours: 1 });
    await adminDb().enrollmentToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await enroll(expired.token)).status).toBe(401);

    const once = await createEnrollmentToken(ctx, { name: "o", expiresInHours: 1, maxUses: 1 });
    expect((await enroll(once.token, "machine-A")).status).toBe(201);
    expect((await enroll(once.token, "machine-B")).status).toBe(401);
    expect((await listEnrollmentTokens(ctx)).find((t) => t.id === once.id)!.state).toBe(
      "exhausted",
    );
  });

  it("validates the enrollment body (422) and content type (415)", async () => {
    const res = await enrollRoute(json({ enrollmentToken: "x" }));
    expect(res.status).toBe(422);
    const plain = await enrollRoute(
      new Request("http://localhost", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(plain.status).toBe(415);
  });
});

describe("agent reports", () => {
  it("creates a DISCOVERED host resource, then records metadata changes", async () => {
    const ctx = await ownerContext("Acme");
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
    const { status, body } = await enroll(token);
    expect(status).toBe(201);
    expect(body.agentSecret).toMatch(/^dmp_agt_/);
    expect(body.config).toEqual({ reportIntervalSec: 300, sampleIntervalSec: 30 });

    const res = await report(body.agentSecret as string);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      config: { reportIntervalSec: 300, sampleIntervalSec: 30 },
      features: ["workloads", "workloads-linux"],
    });

    const [host] = await listResources(ctx);
    expect(host).toMatchObject({
      name: "APP01",
      type: "SERVER",
      status: "DISCOVERED",
      source: "AGENT",
      externalId: body.agentId,
      metadata: { hostname: "APP01", ipAddresses: ["10.0.0.23"] },
    });
    expect(host!.lastSeenAt).toBeInstanceOf(Date);

    // Humans own name/notes; the agent only updates metadata + lastSeenAt.
    await adminDb().resource.update({
      where: { id: host!.id },
      data: { name: "APP01 (web)", notes: "keep" },
    });
    const changed = sampleReport();
    changed.interfaces[0]!.addresses = ["10.0.0.99/24"];
    expect((await report(body.agentSecret as string, changed)).status).toBe(202);

    const after = (await listResources(ctx))[0]!;
    expect(after.name).toBe("APP01 (web)");
    expect(after.notes).toBe("keep");
    expect(after.metadata.ipAddresses).toEqual(["10.0.0.99"]);
    const events = await listChangesForResource(ctx, host!.id);
    expect(events.map((e) => [e.actorType, e.kind])).toEqual([
      ["AGENT", "UPDATED"],
      ["AGENT", "DISCOVERED"],
    ]);
    expect(await adminDb().observation.count({ where: { agentId: body.agentId as string } })).toBe(
      2,
    );

    const [agent] = await listAgents(ctx);
    expect(agent).toMatchObject({ hostname: "APP01", resourceId: host!.id, lastIp: "203.0.113.7" });
  });

  it("rejects unauthenticated, revoked and malformed reports", async () => {
    const ctx = await ownerContext("Acme");
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
    const { body } = await enroll(token);
    const secret = body.agentSecret as string;

    expect((await reportRoute(json(sampleReport()))).status).toBe(401);
    expect((await report("dmp_agt_" + "b".repeat(43))).status).toBe(401);

    expect((await report(secret, { ...sampleReport(), schemaVersion: 2 })).status).toBe(422);
    const smuggled = sampleReport();
    (smuggled.host as Record<string, unknown>).cmdline = "secret";
    expect((await report(secret, smuggled)).status).toBe(422);
    expect((await report(secret, "{not json")).status).toBe(400);
    const huge = sampleReport({
      services: Array.from({ length: 900 }, (_, i) => ({
        name: `svc-${i}-${"x".repeat(1200)}`.slice(0, 256),
        displayName: "y".repeat(256),
        state: "running",
        startType: "auto",
      })),
    });
    huge.listeners = Array.from({ length: 500 }, (_, i) => ({
      proto: "tcp",
      address: "0".repeat(64),
      port: i,
      process: { name: "p".repeat(256), path: "q".repeat(1024) },
    }));
    expect((await report(secret, huge)).status).toBe(413);
    expect(await adminDb().observation.count()).toBe(0);

    await revokeAgent(ctx, body.agentId as string);
    expect((await report(secret)).status).toBe(401);
  });

  it("re-enrolling the same machine reuses the agent and invalidates the old secret", async () => {
    const ctx = await ownerContext("Acme");
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
    const first = await enroll(token);
    const second = await enroll(token);
    expect(second.body.agentId).toBe(first.body.agentId);
    expect((await report(first.body.agentSecret as string)).status).toBe(401);
    expect((await report(second.body.agentSecret as string)).status).toBe(202);
  });

  it("an agent can only ever write to its own workspace", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const { token } = await createEnrollmentToken(acme, { name: "t", expiresInHours: 24 });
    const { body } = await enroll(token);
    await report(body.agentSecret as string);

    expect(await listResources(acme)).toHaveLength(1);
    expect(await listResources(globex)).toHaveLength(0);
    expect(await listAgents(globex)).toEqual([]);
    await expect(revokeAgent(globex, body.agentId as string)).rejects.toThrow();
  });

  it("rate limits reports per agent", async () => {
    const ctx = await ownerContext("Acme");
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
    const { body } = await enroll(token);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await report(body.agentSecret as string)).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("agent-side collectors (ADR-018 C)", () => {
  const inventory = {
    source: "proxmox" as const,
    collectedAt: "2026-09-28T12:00:00.000Z",
    items: [
      { id: "node/pve01", type: "node" as const, node: "pve01", status: "online" },
      {
        id: "qemu/100",
        type: "qemu" as const,
        node: "pve01",
        name: "APP01",
        vmid: 100,
        status: "running",
        maxmem: 8589934592,
      },
      {
        id: "lxc/101",
        type: "lxc" as const,
        node: "pve01",
        name: "redis",
        vmid: 101,
        status: "running",
      },
    ],
  };

  it("imports the inventory through the importer pipeline, attributed to the agent", async () => {
    const ctx = await ownerContext("Acme");
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
    const { body } = await enroll(token);
    const secret = body.agentSecret as string;
    expect((await report(secret, sampleReport({ inventory }))).status).toBe(202);

    const names = (await listResources(ctx)).map((r) => r.name).sort();
    // APP01 (the agent host) is matched by name, not duplicated.
    expect(names).toEqual(["APP01", "pve01", "redis"]);
    const node = (await listResources(ctx)).find((r) => r.name === "pve01")!;
    const rels = await listRelationshipsForResource(ctx, node.id);
    expect(rels.map((r) => [r.type, r.status, r.origin])).toEqual([
      ["HOSTS", "CONFIRMED", "DETECTED"],
      ["HOSTS", "CONFIRMED", "DETECTED"],
    ]);
    const feed = await listWorkspaceChanges(ctx, { actor: "agent" });
    expect(feed.events.some((e) => e.summary.includes("pve01") && e.actorName === "APP01")).toBe(
      true,
    );

    // Same inventory again: idempotent, no new events.
    const before = (await listWorkspaceChanges(ctx, {})).events.length;
    expect((await report(secret, sampleReport({ inventory }))).status).toBe(202);
    expect((await listWorkspaceChanges(ctx, {})).events.length).toBe(before);
  });

  it("rejects unknown inventory fields and never fails the report on a bad inventory", async () => {
    const ctx = await ownerContext("Acme");
    const { token } = await createEnrollmentToken(ctx, { name: "t", expiresInHours: 24 });
    const { body } = await enroll(token);
    const secret = body.agentSecret as string;
    const leaky = { ...inventory, items: [{ ...inventory.items[0], password: "x" }] };
    expect((await report(secret, sampleReport({ inventory: leaky as never }))).status).toBe(422);
    // A template-only inventory has nothing importable: report still accepted.
    const empty = {
      ...inventory,
      items: [{ id: "qemu/9000", type: "qemu" as const, name: "tpl", template: 1 }],
    };
    expect((await report(secret, sampleReport({ inventory: empty }))).status).toBe(202);
  });
});
