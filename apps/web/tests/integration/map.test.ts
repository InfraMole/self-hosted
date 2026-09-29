// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/server/authz";
import { getWorkspaceGraph } from "@/server/modules/map/map";
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
