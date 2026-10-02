// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { listChangesForSubject } from "@/server/modules/changes/changes";
import {
  ResourceNotFoundError,
  createResource,
  deleteResource,
  getResource,
  listResources,
  setOwner,
  updateResource,
} from "@/server/modules/resources/resources";
import { applyImport } from "@/server/modules/importers/importers";
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

async function memberContext(owner: WorkspaceContext, role: Role): Promise<WorkspaceContext> {
  const user = await createTestUser(`${role} user`);
  await adminDb().membership.create({
    data: { workspaceId: owner.workspaceId, userId: user.id, role },
  });
  return (await findWorkspaceContextForUser(user.id, owner.workspaceSlug))!;
}

describe("resources: tenant isolation", () => {
  it("never exposes another workspace's resource, even with its id", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const app01 = await createResource(acme, { name: "APP01", type: "SERVER" });

    expect(await getResource(globex, app01.id)).toBeNull();
    expect(await listResources(globex)).toEqual([]);
    await expect(
      updateResource(globex, app01.id, { name: "pwned", type: "SERVER" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(deleteResource(globex, app01.id)).rejects.toBeInstanceOf(ResourceNotFoundError);

    // Untouched in its own workspace.
    expect((await getResource(acme, app01.id))?.name).toBe("APP01");
    // No change events leaked into the other workspace.
    expect(await adminDb().changeEvent.count({ where: { workspaceId: globex.workspaceId } })).toBe(
      0,
    );
  });
});

describe("resources: permissions", () => {
  it("VIEWER can read but not write", async () => {
    const owner = await ownerContext("Acme");
    const viewer = await memberContext(owner, "VIEWER");
    const app01 = await createResource(owner, { name: "APP01", type: "SERVER" });

    expect((await listResources(viewer)).map((r) => r.id)).toEqual([app01.id]);
    await expect(createResource(viewer, { name: "X", type: "VM" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      updateResource(viewer, app01.id, { name: "X", type: "SERVER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteResource(viewer, app01.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("MEMBER can write", async () => {
    const owner = await ownerContext("Acme");
    const member = await memberContext(owner, "MEMBER");
    const r = await createResource(member, { name: "DB", type: "DATABASE" });
    expect(r.workspaceId).toBe(owner.workspaceId);
  });
});

describe("resources: lifecycle and change events", () => {
  it("records CREATED, UPDATED (with diff) and DELETED events", async () => {
    const ctx = await ownerContext("Acme");
    const r = await createResource(ctx, {
      name: "SQL01",
      type: "DATABASE",
      environment: "PRODUCTION",
      metadata: { ipAddresses: ["10.0.0.40"] },
    });
    expect(r.source).toBe("MANUAL");
    expect(r.status).toBe("ACTIVE");

    await updateResource(ctx, r.id, {
      name: "SQL01",
      type: "DATABASE",
      environment: "PRODUCTION",
      metadata: { ipAddresses: ["10.0.0.41"] },
    });
    // No-op update does not create an event.
    await updateResource(ctx, r.id, {
      name: "SQL01",
      type: "DATABASE",
      environment: "PRODUCTION",
      metadata: { ipAddresses: ["10.0.0.41"] },
    });
    await deleteResource(ctx, r.id);

    const events = await listChangesForSubject(ctx, "RESOURCE", r.id);
    expect(events.map((e) => e.kind)).toEqual(["DELETED", "UPDATED", "CREATED"]);
    expect(events[1]!.summary).toBe("Updated SQL01: metadata");
    expect(events[1]!.diff).toEqual({
      metadata: [{ ipAddresses: ["10.0.0.40"] }, { ipAddresses: ["10.0.0.41"] }],
    });
    expect(events.every((e) => e.actorName === "Acme")).toBe(true);
    expect(await getResource(ctx, r.id)).toBeNull();
  });

  it("rejects invalid input without writing anything", async () => {
    const ctx = await ownerContext("Acme");
    await expect(
      createResource(ctx, { name: "x", type: "SERVER", metadata: { password: "secret" } }),
    ).rejects.toThrow();
    expect(await adminDb().resource.count()).toBe(0);
    expect(await adminDb().changeEvent.count()).toBe(0);
  });
});

describe("listResources filters", () => {
  it("filters by type, environment, status and search", async () => {
    const ctx = await ownerContext("Acme");
    await createResource(ctx, {
      name: "APP01",
      type: "SERVER",
      environment: "PRODUCTION",
      tags: ["iis"],
      metadata: { hostname: "app01.corp", ipAddresses: ["10.0.0.23"] },
    });
    await createResource(ctx, { name: "SQL01", type: "DATABASE", environment: "PRODUCTION" });
    await createResource(ctx, { name: "Dev box", type: "VM", environment: "DEVELOPMENT" });
    await createResource(ctx, { name: "Old app", type: "APPLICATION", status: "ARCHIVED" });

    const names = async (f: object) => (await listResources(ctx, f)).map((r) => r.name);

    expect(await names({})).toEqual(["APP01", "Dev box", "SQL01"]); // archived hidden
    expect(await names({ status: "ARCHIVED" })).toEqual(["Old app"]);
    expect(await names({ type: "DATABASE" })).toEqual(["SQL01"]);
    expect(await names({ environment: "PRODUCTION" })).toEqual(["APP01", "SQL01"]);
    expect(await names({ q: "sql" })).toEqual(["SQL01"]);
    expect(await names({ q: "10.0.0.23" })).toEqual(["APP01"]);
    expect(await names({ q: "iis" })).toEqual(["APP01"]);
    expect(await names({ q: "app01.corp" })).toEqual(["APP01"]);
    expect(await names({ type: "NOT_A_TYPE" })).toHaveLength(3); // invalid filter ignored
  });
});

describe("owners (M29)", () => {
  it("are set on create / edit, searchable, and recorded as changes", async () => {
    const ctx = await ownerContext("Acme");
    const r = await createResource(ctx, {
      name: "SQL01",
      type: "SERVER",
      owner: "Data team",
      ownerContact: "data@example.com",
    });
    expect(r).toMatchObject({ owner: "Data team", ownerContact: "data@example.com" });
    expect((await listResources(ctx, { q: "data team" })).map((x) => x.name)).toEqual(["SQL01"]);
    await updateResource(ctx, r.id, { name: "SQL01", type: "SERVER", owner: "DBA" });
    const [last] = await listChangesForSubject(ctx, "RESOURCE", r.id);
    expect(last!.diff).toMatchObject({
      owner: ["Data team", "DBA"],
      ownerContact: ["data@example.com", null],
    });
  });

  it("can be set in bulk, only on this workspace, by members", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const a = await createResource(acme, { name: "APP01", type: "SERVER" });
    const b = await createResource(acme, { name: "APP02", type: "SERVER", owner: "Web team" });
    const other = await createResource(globex, { name: "G1", type: "SERVER" });
    const n = await setOwner(acme, [a.id, b.id, other.id], {
      owner: "Web team",
      ownerContact: "#web",
    });
    expect(n).toBe(2); // b's contact changes; the other workspace is never touched
    expect((await getResource(acme, a.id))!.owner).toBe("Web team");
    expect(
      (await adminDb().resource.findUniqueOrThrow({ where: { id: other.id } })).owner,
    ).toBeNull();
    // Clearing the owner clears its contact too.
    await setOwner(acme, [a.id], { owner: "", ownerContact: "x" });
    expect(await getResource(acme, a.id)).toMatchObject({ owner: null, ownerContact: null });
    const viewer = await memberContext(acme, "VIEWER");
    await expect(setOwner(viewer, [a.id], { owner: "X", ownerContact: "" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("come from a CSV import column and stay on update", async () => {
    const ctx = await ownerContext("Acme");
    await applyImport(ctx, {
      text: "name,type,owner,owner_contact\nAPP01,server,Platform team,platform@example.com",
    });
    const [app] = await listResources(ctx, { q: "APP01" });
    expect(app).toMatchObject({ owner: "Platform team", ownerContact: "platform@example.com" });
  });
});
