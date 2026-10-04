// SPDX-License-Identifier: AGPL-3.0-only
/** Library for large inventories (M31, ADR-045): pages, sorting, duplicate names. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/server/authz";
import {
  LIBRARY_PAGE_SIZE,
  findSameName,
  listResourcesPage,
} from "@/server/modules/resources/resources";
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

const names = (page: { rows: { name: string }[] }) => page.rows.map((r) => r.name);

describe("Library pages (M31)", () => {
  it("pages beyond 500 rows without overlap, and clamps a page past the end", async () => {
    const ctx = await ownerContext("Acme");
    await adminDb().resource.createMany({
      data: Array.from({ length: 620 }, (_, i) => ({
        workspaceId: ctx.workspaceId,
        name: `srv-${String(i).padStart(3, "0")}`,
        type: "SERVER" as const,
      })),
    });
    const first = await listResourcesPage(ctx, {});
    expect(first).toMatchObject({ total: 620, page: 1, pages: 7, sort: "name", dir: "asc" });
    expect(first.rows).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(first.rows[0]!.name).toBe("srv-000");

    const seen = new Set<string>();
    for (let page = 1; page <= 7; page++)
      for (const r of (await listResourcesPage(ctx, { page: String(page) })).rows) seen.add(r.id);
    expect(seen.size).toBe(620);

    const last = await listResourcesPage(ctx, { page: "99" });
    expect(last.page).toBe(7);
    expect(names(last).at(-1)).toBe("srv-619");
    // Garbage in the URL falls back to the defaults.
    expect(await listResourcesPage(ctx, { page: "x", sort: "nope", dir: "up" })).toMatchObject({
      page: 1,
      sort: "name",
      dir: "asc",
    });
  });

  it("sorts by column, enums in declared order, empty values last", async () => {
    const ctx = await ownerContext("Acme");
    const r = (name: string, extra: object) =>
      adminDb().resource.create({
        data: { workspaceId: ctx.workspaceId, name, type: "SERVER", ...extra },
      });
    await r("a-low", { criticality: "LOW", owner: "Zed team" });
    await r("b-none", {});
    await r("c-critical", { criticality: "CRITICAL", owner: "alpha team" });
    await r("d-high", { criticality: "HIGH", type: "DATABASE" });

    expect(names(await listResourcesPage(ctx, { sort: "criticality" }))).toEqual([
      "c-critical",
      "d-high",
      "a-low",
      "b-none",
    ]);
    expect(names(await listResourcesPage(ctx, { sort: "criticality", dir: "asc" }))).toEqual([
      "a-low",
      "d-high",
      "c-critical",
      "b-none",
    ]);
    const byOwner = names(await listResourcesPage(ctx, { sort: "owner" }));
    expect(byOwner.slice(2)).toEqual(["b-none", "d-high"]); // no owner: last, then by name
    expect(names(await listResourcesPage(ctx, { sort: "name", dir: "desc" }))[0]).toBe("d-high");
    expect(names(await listResourcesPage(ctx, { sort: "type", type: "DATABASE" }))).toEqual([
      "d-high",
    ]);
  });
});

describe("duplicate names (M31)", () => {
  it("finds the same name in any case and status, except the resource itself", async () => {
    const ctx = await ownerContext("Acme");
    const other = await ownerContext("Globex");
    const web = await adminDb().resource.create({
      data: { workspaceId: ctx.workspaceId, name: "WEB01", type: "SERVER" },
    });
    await adminDb().resource.create({
      data: { workspaceId: ctx.workspaceId, name: "web01", type: "VM", status: "ARCHIVED" },
    });
    await adminDb().resource.create({
      data: { workspaceId: other.workspaceId, name: "web01", type: "SERVER" },
    });
    expect((await findSameName(ctx, " web01 ")).map((d) => d.status).sort()).toEqual([
      "ACTIVE",
      "ARCHIVED",
    ]);
    expect(await findSameName(ctx, "web01", web.id)).toHaveLength(1);
    expect(await findSameName(ctx, "web02")).toEqual([]);
    expect(await findSameName(other, "WEB01")).toHaveLength(1); // its own only
  });
});
