// SPDX-License-Identifier: AGPL-3.0-only
/** Resilience report (M44, ADR-060): scope, confidence, redundancy, tenancy, Library sort. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role, WorkspaceContext } from "@/server/authz";
import { saveView } from "@/server/modules/map/views";
import {
  ResilienceViewError,
  couldAffectOf,
  getResilience,
} from "@/server/modules/resilience/resilience";
import { listResourcesPage } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
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

/**
 * Production: portal → billing → CustomersDB (two replicas) → pve01, and a
 * detected portal → reports edge. Staging: a test app on its own server.
 */
async function seed(ctx: WorkspaceContext) {
  const db = adminDb();
  const r = async (name: string, extra: object = {}) =>
    (
      await db.resource.create({
        data: {
          workspaceId: ctx.workspaceId,
          name,
          type: "APPLICATION",
          environment: "PRODUCTION",
          ...extra,
        },
      })
    ).id;
  const pve = await r("pve01", { type: "SERVER", owner: "Infra", criticality: "HIGH" });
  const db1 = await r("db1", { type: "DATABASE", redundancyGroup: "customers-db" });
  const db2 = await r("db2", { type: "DATABASE", redundancyGroup: "customers-db" });
  const billing = await r("billing", { owner: "Finance apps" });
  const portal = await r("portal");
  const reports = await r("reports");
  const testApp = await r("test-app", { environment: "STAGING" });
  const testSrv = await r("test-srv", { type: "SERVER", environment: "STAGING" });
  const old = await r("old", { status: "ARCHIVED" });
  const rel = (from: string, type: string, to: string, extra: object = {}) =>
    db.relationship.create({
      data: {
        workspaceId: ctx.workspaceId,
        fromResourceId: from,
        toResourceId: to,
        type: type as never,
        origin: "MANUAL",
        status: "CONFIRMED",
        ...extra,
      },
    });
  await rel(db1, "RUNS_ON", pve);
  await rel(db2, "RUNS_ON", pve);
  await rel(billing, "USES_DATABASE", db1);
  await rel(billing, "USES_DATABASE", db2);
  await rel(portal, "CALLS", billing);
  await rel(reports, "CALLS", portal, { origin: "DETECTED", status: "UNCONFIRMED" });
  await rel(testApp, "RUNS_ON", testSrv);
  await rel(old, "DEPENDS_ON", pve);
  await rel(portal, "DEPENDS_ON", pve, { status: "IGNORED" });
  return { pve, db1, db2, billing, portal, reports, testApp, testSrv, old };
}

const ranked = (report: Awaited<ReturnType<typeof getResilience>>) =>
  Object.fromEntries(report.ranking.map((r) => [r.resource.name, r.couldAffect]));

describe("Resilience report (M44)", () => {
  it("ranks, finds single points of failure and orders recovery", async () => {
    const ctx = await ownerContext("Acme");
    await seed(ctx);
    const report = await getResilience(ctx, {});
    expect(report).toMatchObject({
      scope: { environment: null, view: null, confidence: "detected" },
      resources: 8, // archived excluded
      relationships: 7, // ignored and archived edges excluded
      unreviewed: 1,
      tooLarge: false,
    });
    expect(ranked(report)).toMatchObject({
      pve01: 5, // both replicas, then billing, portal, reports
      db1: 0, // its replica covers it
      billing: 2,
      portal: 1,
      "test-srv": 1,
    });
    const db1 = report.ranking.find((r) => r.resource.name === "db1")!;
    expect(db1.covered).toBe(3);
    expect(report.ranking[0]!.resource.name).toBe("pve01");
    // Ties: more confirmed first (portal's only dependent is detected).
    expect(report.singlePoints.map((r) => r.resource.name)).toEqual([
      "pve01",
      "billing",
      "test-srv",
      "portal",
    ]);
    expect(
      report.recovery.waves.map((w) =>
        w.map((s) => [s.resources.map((r) => r.name).join("+"), s.groupName]),
      ),
    ).toEqual([
      [
        ["pve01", null],
        ["test-srv", null],
      ],
      [
        ["db1+db2", "customers-db"],
        ["test-app", null],
      ],
      [["billing", null]],
      [["portal", null]],
      [["reports", null]],
    ]);
    expect(report.recovery.unconnected).toEqual([]);
  });

  it("follows the confidence filter, the environment and a saved view", async () => {
    const ctx = await ownerContext("Acme");
    await seed(ctx);

    const confirmed = await getResilience(ctx, { confidence: "confirmed" });
    expect(ranked(confirmed).pve01).toBe(4);
    expect(confirmed.recovery.unconnected.map((r) => r.name)).toEqual(["reports"]);

    const staging = await getResilience(ctx, { environment: "STAGING" });
    expect(staging).toMatchObject({ resources: 2, relationships: 1 });
    expect(staging.singlePoints.map((r) => r.resource.name)).toEqual(["test-srv"]);

    const { id } = await saveView(ctx, {
      name: "Servers",
      state: { type: "SERVER" },
    });
    const servers = await getResilience(ctx, { view: id });
    expect(servers.scope.view).toEqual({ id, name: "Servers" });
    expect(servers.ranking.map((r) => r.resource.name).sort()).toEqual(["pve01", "test-srv"]);
    // Nothing between two servers: no single point of failure in this scope.
    expect(servers.singlePoints).toEqual([]);
    expect(servers.recovery.unconnected).toHaveLength(2);

    await expect(getResilience(ctx, { confidence: "maybe" })).rejects.toThrow();
  });

  it("only ever reads the caller's workspace; viewers can read it", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    await seed(acme);
    const { id } = await saveView(acme, { name: "Acme view", state: {} });

    expect((await getResilience(globex, {})).resources).toBe(0);
    await expect(getResilience(globex, { view: id })).rejects.toThrow(ResilienceViewError);

    const viewer = await memberContext(acme, "VIEWER");
    expect((await getResilience(viewer, {})).resources).toBe(8);
  });

  it("sorts the Library by what each resource could affect", async () => {
    const ctx = await ownerContext("Acme");
    const s = await seed(ctx);
    const other = await ownerContext("Globex");
    const foreign = await seed(other);

    const page = await listResourcesPage(ctx, { sort: "impact" });
    expect(page.dir).toBe("desc");
    expect(page.rows.map((r) => r.name).slice(0, 4)).toEqual([
      "pve01",
      "billing",
      "portal",
      "test-srv",
    ]);
    expect(page.couldAffect.get(s.pve)).toBe(5);
    const asc = await listResourcesPage(ctx, { sort: "impact", dir: "asc" });
    expect(asc.rows.at(-1)!.name).toBe("pve01");
    // Default sort still fills the column for the rows of the page.
    const byName = await listResourcesPage(ctx, {});
    expect(byName.couldAffect.get(s.billing)).toBe(2);
    // Another workspace's ids count nothing.
    expect((await couldAffectOf(ctx, [foreign.pve])).get(foreign.pve)).toBeUndefined();
  });
});
