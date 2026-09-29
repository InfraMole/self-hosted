// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/server/authz";
import { getResourceImpact } from "@/server/modules/impact/impact";
import { createRelationship } from "@/server/modules/relationships/relationships";
import { createResource } from "@/server/modules/resources/resources";
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

describe("getResourceImpact", () => {
  it("computes the blast radius with confidence, hops and path names", async () => {
    const ctx = await ownerContext("Acme");
    const sql = await createResource(ctx, { name: "SQL01", type: "SERVER" });
    const db = await createResource(ctx, { name: "CustomersDB", type: "DATABASE" });
    const api = await createResource(ctx, { name: "CustomerAPI", type: "API" });
    const web = await createResource(ctx, { name: "Web", type: "APPLICATION" });
    const nas = await createResource(ctx, { name: "NAS01", type: "STORAGE" });
    const link = (
      from: string,
      type: "RUNS_ON" | "USES_DATABASE" | "CALLS" | "BACKS_UP_TO",
      to: string,
    ) => createRelationship(ctx, { fromResourceId: from, toResourceId: to, type });
    await link(db.id, "RUNS_ON", sql.id);
    await link(api.id, "USES_DATABASE", db.id);
    await link(web.id, "CALLS", api.id);
    await link(sql.id, "BACKS_UP_TO", nas.id);

    // An unconfirmed detected edge: must be labelled "detected", never confirmed.
    const detected = await createResource(ctx, { name: "Reporting", type: "APPLICATION" });
    const rel = await createRelationship(ctx, {
      fromResourceId: detected.id,
      toResourceId: sql.id,
      type: "CONNECTS_TO",
    });
    await adminDb().relationship.update({
      where: { id: rel.id },
      data: { origin: "DETECTED", status: "UNCONFIRMED" },
    });

    const result = (await getResourceImpact(ctx, sql.id))!;
    expect(result.root.name).toBe("SQL01");
    expect(result.affected.map((a) => [a.resource.name, a.depth, a.confidence])).toEqual([
      ["CustomersDB", 1, "confirmed"],
      ["CustomerAPI", 2, "confirmed"],
      ["Web", 3, "confirmed"],
      ["Reporting", 1, "detected"],
    ]);
    expect(result.affected[2]!.pathNames).toEqual(["SQL01", "CustomersDB", "CustomerAPI", "Web"]);
    expect(result.summary).toEqual({
      total: 4,
      byConfidence: { confirmed: 3, detected: 1, inferred: 0 },
      byType: { DATABASE: 1, API: 1, APPLICATION: 2 },
    });

    expect((await getResourceImpact(ctx, sql.id, 1))!.affected).toHaveLength(2);
  });

  it("returns null for a resource of another workspace", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const r = await createResource(acme, { name: "A", type: "SERVER" });
    expect(await getResourceImpact(globex, r.id)).toBeNull();
  });
});
