// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import { getWorkspaceGraph } from "@/server/modules/map/map";
import { getFirstStepsFacts } from "@/server/modules/workspaces/first-steps";
import {
  SavedViewError,
  deleteSavedView,
  listSavedViews,
  saveView,
} from "@/server/modules/map/views";
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

describe("getWorkspaceGraph", () => {
  it("returns only this workspace's graph, without archived nodes or ignored edges", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");

    const api = await createResource(acme, {
      name: "API",
      type: "API",
      metadata: { ipAddresses: ["10.0.0.9"] },
    });
    const db = await createResource(acme, { name: "DB", type: "DATABASE" });
    const old = await createResource(acme, { name: "Old", type: "SERVER", status: "ARCHIVED" });
    const cache = await createResource(acme, { name: "Cache", type: "CONTAINER" });
    await createRelationship(acme, {
      fromResourceId: api.id,
      toResourceId: db.id,
      type: "USES_DATABASE",
    });
    await createRelationship(acme, { fromResourceId: api.id, toResourceId: old.id, type: "CALLS" });
    const ignored = await createRelationship(acme, {
      fromResourceId: api.id,
      toResourceId: cache.id,
      type: "DEPENDS_ON",
    });
    await adminDb().relationship.update({ where: { id: ignored.id }, data: { status: "IGNORED" } });

    const other = await createResource(globex, { name: "Globex server", type: "SERVER" });

    const graph = await getWorkspaceGraph(acme);
    expect(graph.nodes.map((n) => n.name)).toEqual(["API", "Cache", "DB"]);
    expect(graph.nodes.find((n) => n.name === "API")!.ipAddresses).toEqual(["10.0.0.9"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: api.id, to: db.id, type: "USES_DATABASE" });
    expect(graph.nodes.some((n) => n.id === other.id)).toBe(false);

    expect((await getWorkspaceGraph(globex)).nodes.map((n) => n.name)).toEqual(["Globex server"]);
  });
});

describe("saved views (M26 phase 3)", () => {
  const state = (pinned = {}) => ({
    type: "SERVER",
    focus: null,
    groupMode: "collapsed",
    pinned,
  });

  it("are shared within the workspace and isolated from others", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const { id } = await saveView(acme, {
      name: "Servers",
      state: state({ abc: { x: 10, y: 20, parent: null } }),
    });
    const [view] = await listSavedViews(acme);
    expect(view).toMatchObject({ id, name: "Servers" });
    // Defaults filled in by the schema.
    expect(view!.state).toMatchObject({ showInformational: true, impact: null, groups: {} });
    expect(view!.state.pinned).toEqual({ abc: { x: 10, y: 20, parent: null } });
    expect(await listSavedViews(globex)).toEqual([]);
    // Another workspace can neither overwrite nor delete it.
    await expect(saveView(globex, { id, name: "Hijack", state: state() })).rejects.toThrow(
      SavedViewError,
    );
    await expect(deleteSavedView(globex, id)).rejects.toThrow(SavedViewError);
    expect((await listSavedViews(acme))[0]!.name).toBe("Servers");
  });

  it("names are unique per workspace; overwrite and delete", async () => {
    const acme = await ownerContext("Acme");
    const { id } = await saveView(acme, { name: "Servers", state: state() });
    await expect(saveView(acme, { name: "Servers", state: state() })).rejects.toThrow(
      /already exists/,
    );
    await saveView(acme, { id, name: "All servers", state: { ...state(), groupMode: "auto" } });
    expect((await listSavedViews(acme))[0]).toMatchObject({
      name: "All servers",
      state: { groupMode: "auto" },
    });
    await deleteSavedView(acme, id);
    expect(await listSavedViews(acme)).toEqual([]);
  });

  it("viewers can open views but not save them; bad input is refused", async () => {
    const acme = await ownerContext("Acme");
    await saveView(acme, { name: "Servers", state: state() });
    const viewer = { ...acme, role: "VIEWER" as const };
    expect(await listSavedViews(viewer)).toHaveLength(1);
    await expect(saveView(viewer, { name: "Mine", state: state() })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      saveView(acme, { name: "Bad", state: { ...state(), pinned: { "x y": { x: 1, y: 1 } } } }),
    ).rejects.toThrow();
    await expect(saveView(acme, { name: " ", state: state() })).rejects.toThrow();
  });
});

describe("first steps (M28)", () => {
  it("knows what exists and picks the resource with the most that could be affected", async () => {
    const acme = await ownerContext("Acme");
    expect(await getFirstStepsFacts(acme)).toEqual({
      resources: 0,
      pendingSuggestions: 0,
      confirmedRelationships: 0,
      showcase: null,
    });
    const sql = await createResource(acme, { name: "SQL01", type: "SERVER" });
    const db = await createResource(acme, { name: "orders-db", type: "DATABASE" });
    const app = await createResource(acme, { name: "shop", type: "APPLICATION" });
    await createRelationship(acme, {
      fromResourceId: db.id,
      toResourceId: sql.id,
      type: "RUNS_ON",
    });
    await createRelationship(acme, {
      fromResourceId: app.id,
      toResourceId: db.id,
      type: "USES_DATABASE",
    });
    const facts = await getFirstStepsFacts(acme);
    expect(facts).toMatchObject({ resources: 3, confirmedRelationships: 2 });
    // SQL01 takes orders-db and shop with it; orders-db only shop.
    expect(facts.showcase).toEqual({ id: sql.id, name: "SQL01", affected: 2 });
    // Another workspace sees none of it.
    expect((await getFirstStepsFacts(await ownerContext("Globex"))).resources).toBe(0);
  });
});
