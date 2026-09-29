// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { listChangesForResource } from "@/server/modules/changes/changes";
import {
  RelationshipEndpointError,
  RelationshipExistsError,
  RelationshipNotFoundError,
  createRelationship,
  deleteRelationship,
  listRelationshipsForResource,
  updateRelationship,
} from "@/server/modules/relationships/relationships";
import { createResource, deleteResource } from "@/server/modules/resources/resources";
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

const server = (ctx: WorkspaceContext, name: string) =>
  createResource(ctx, { name, type: "SERVER" });

describe("relationships: tenant isolation", () => {
  it("the DATABASE rejects an edge between resources of different workspaces", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const a = await server(acme, "A");
    const g = await server(globex, "G");

    // Bypass the module on purpose: the composite FK must stop this on its own.
    await expect(
      adminDb().relationship.create({
        data: {
          workspaceId: acme.workspaceId,
          fromResourceId: a.id,
          toResourceId: g.id,
          type: "CALLS",
        },
      }),
    ).rejects.toThrow();
    await expect(
      adminDb().relationship.create({
        data: {
          workspaceId: globex.workspaceId,
          fromResourceId: a.id,
          toResourceId: g.id,
          type: "CALLS",
        },
      }),
    ).rejects.toThrow();
    expect(await adminDb().relationship.count()).toBe(0);
  });

  it("the module refuses foreign resources and foreign relationships", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const a1 = await server(acme, "A1");
    const a2 = await server(acme, "A2");
    const g = await server(globex, "G");

    await expect(
      createRelationship(acme, { fromResourceId: a1.id, toResourceId: g.id, type: "CALLS" }),
    ).rejects.toBeInstanceOf(RelationshipEndpointError);

    const rel = await createRelationship(acme, {
      fromResourceId: a1.id,
      toResourceId: a2.id,
      type: "CALLS",
    });
    await expect(updateRelationship(globex, rel.id, { type: "OTHER" })).rejects.toBeInstanceOf(
      RelationshipNotFoundError,
    );
    await expect(deleteRelationship(globex, rel.id)).rejects.toBeInstanceOf(
      RelationshipNotFoundError,
    );
    expect(await listRelationshipsForResource(globex, a1.id)).toEqual([]);
  });

  it("the database rejects self-loops", async () => {
    const acme = await ownerContext("Acme");
    const a = await server(acme, "A");
    await expect(
      adminDb().relationship.create({
        data: {
          workspaceId: acme.workspaceId,
          fromResourceId: a.id,
          toResourceId: a.id,
          type: "CALLS",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("relationships: lifecycle", () => {
  it("creates confirmed manual edges, rejects duplicates, records activity on both ends", async () => {
    const ctx = await ownerContext("Acme");
    const api = await createResource(ctx, { name: "CustomerAPI", type: "API" });
    const sql = await server(ctx, "SQL01");

    const rel = await createRelationship(ctx, {
      fromResourceId: api.id,
      toResourceId: sql.id,
      type: "USES_DATABASE",
    });
    const [view] = await listRelationshipsForResource(ctx, sql.id);
    expect(view).toMatchObject({
      id: rel.id,
      origin: "MANUAL",
      status: "CONFIRMED",
      from: { name: "CustomerAPI" },
      to: { name: "SQL01" },
    });
    expect(view!.confirmedAt).toBeInstanceOf(Date);

    await expect(
      createRelationship(ctx, {
        fromResourceId: api.id,
        toResourceId: sql.id,
        type: "USES_DATABASE",
      }),
    ).rejects.toBeInstanceOf(RelationshipExistsError);
    // Same pair, different type is allowed.
    await createRelationship(ctx, {
      fromResourceId: api.id,
      toResourceId: sql.id,
      type: "CONNECTS_TO",
    });

    await updateRelationship(ctx, rel.id, { type: "USES_DATABASE", note: "Read replica" });
    await deleteRelationship(ctx, rel.id);

    for (const id of [api.id, sql.id]) {
      const summaries = (await listChangesForResource(ctx, id)).map((e) => e.summary);
      expect(summaries).toContain("Added relationship: CustomerAPI uses database SQL01");
      expect(summaries).toContain("Updated relationship: CustomerAPI uses database SQL01");
      expect(summaries).toContain("Removed relationship: CustomerAPI uses database SQL01");
    }
  });

  it("cascades when a resource is deleted", async () => {
    const ctx = await ownerContext("Acme");
    const a = await server(ctx, "A");
    const b = await server(ctx, "B");
    await createRelationship(ctx, { fromResourceId: a.id, toResourceId: b.id, type: "DEPENDS_ON" });
    await deleteResource(ctx, b.id);
    expect(await adminDb().relationship.count()).toBe(0);
  });

  it("VIEWER cannot create, update or delete", async () => {
    const owner = await ownerContext("Acme");
    const viewer = await memberContext(owner, "VIEWER");
    const a = await server(owner, "A");
    const b = await server(owner, "B");
    const rel = await createRelationship(owner, {
      fromResourceId: a.id,
      toResourceId: b.id,
      type: "CALLS",
    });

    await expect(
      createRelationship(viewer, { fromResourceId: b.id, toResourceId: a.id, type: "CALLS" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateRelationship(viewer, rel.id, { type: "OTHER" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(deleteRelationship(viewer, rel.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listRelationshipsForResource(viewer, a.id)).toHaveLength(1);
  });
});
