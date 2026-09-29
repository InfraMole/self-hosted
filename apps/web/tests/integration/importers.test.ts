// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import { listWorkspaceChanges } from "@/server/modules/changes/changes";
import { listSuggestions } from "@/server/modules/discovery/discovery";
import {
  ImportHasErrorsError,
  applyImport,
  previewImport,
} from "@/server/modules/importers/importers";
import { createResource, listResources } from "@/server/modules/resources/resources";
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

const RESOURCES_CSV = `name,type,env,ips,tags
APP01,server,prod,10.0.0.23,iis
SQL01,server,prod,10.0.0.40,
`;
const RELATIONSHIPS_CSV = `from,type,to
APP01,uses database,SQL01
`;

describe("CSV / JSON import", () => {
  it("is idempotent and only updates provided fields", async () => {
    const ctx = await ownerContext("Acme");
    const preview = await previewImport(ctx, { text: RESOURCES_CSV });
    expect(preview.counts).toEqual({ create: 2, update: 0, unchanged: 0, relationships: 0 });

    expect(await applyImport(ctx, { text: RESOURCES_CSV })).toMatchObject({
      format: "csv",
      created: 2,
    });
    const [app] = await listResources(ctx, { q: "APP01" });
    expect(app).toMatchObject({
      source: "IMPORT",
      externalId: "csv:app01",
      environment: "PRODUCTION",
      tags: ["iis"],
    });

    // Human context is never overwritten by later imports.
    await adminDb().resource.update({ where: { id: app!.id }, data: { notes: "human notes" } });
    const eventsBefore = (await listWorkspaceChanges(ctx, {})).events.length;
    expect(await applyImport(ctx, { text: RESOURCES_CSV })).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 2,
    });
    expect((await listWorkspaceChanges(ctx, {})).events.length).toBe(eventsBefore);

    await applyImport(ctx, { text: RESOURCES_CSV.replace("10.0.0.23", "10.0.0.24") });
    const [updated] = await listResources(ctx, { q: "APP01" });
    expect(updated!.metadata.ipAddresses).toEqual(["10.0.0.24"]);
    expect(updated!.notes).toBe("human notes");
    const feed = await listWorkspaceChanges(ctx, { actor: "import" });
    expect(feed.events[0]).toMatchObject({
      actorType: "IMPORTER",
      actorName: "csv",
      summary: "Updated APP01 from csv: ipAddresses",
    });
  });

  it("matches existing manual resources by name + type without taking them over", async () => {
    const ctx = await ownerContext("Acme");
    const manual = await createResource(ctx, { name: "app01", type: "SERVER", notes: "mine" });
    const result = await applyImport(ctx, { text: RESOURCES_CSV });
    expect(result).toMatchObject({ created: 1, updated: 1 });
    const row = await adminDb().resource.findUniqueOrThrow({ where: { id: manual.id } });
    expect(row).toMatchObject({
      source: "MANUAL",
      externalId: null,
      notes: "mine",
      environment: "PRODUCTION",
    });
  });

  it("imports relationships as confirmed facts, or as suggestions when asked", async () => {
    const ctx = await ownerContext("Acme");
    await applyImport(ctx, { text: RESOURCES_CSV });
    expect(await applyImport(ctx, { text: RELATIONSHIPS_CSV })).toMatchObject({
      relationships: 1,
      suggestions: 0,
    });
    const rel = await adminDb().relationship.findFirstOrThrow({});
    expect(rel).toMatchObject({ type: "USES_DATABASE", origin: "MANUAL", status: "CONFIRMED" });
    // Re-import: already exists.
    expect(await applyImport(ctx, { text: RELATIONSHIPS_CSV })).toMatchObject({ relationships: 0 });

    await applyImport(ctx, {
      text: "from,type,to\nSQL01,backs up to,APP01",
      relationshipsAsSuggestions: true,
    });
    const [s] = await listSuggestions(ctx);
    expect(s).toMatchObject({ type: "BACKS_UP_TO", origin: "DETECTED", from: { name: "SQL01" } });
  });

  it("is all-or-nothing when there are errors", async () => {
    const ctx = await ownerContext("Acme");
    const bad = "name,type,ips\nGood,server,10.0.0.1\nBad,server,999.9.9.9";
    const preview = await previewImport(ctx, { text: bad });
    expect(preview.errors).toHaveLength(1);
    await expect(applyImport(ctx, { text: bad })).rejects.toBeInstanceOf(ImportHasErrorsError);
    expect(await adminDb().resource.count()).toBe(0);
  });

  it("VIEWER cannot import; imports never match another workspace", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const viewerUser = await createTestUser("Viewer");
    await adminDb().membership.create({
      data: { workspaceId: acme.workspaceId, userId: viewerUser.id, role: "VIEWER" },
    });
    const viewer = (await findWorkspaceContextForUser(viewerUser.id, acme.workspaceSlug))!;
    await expect(previewImport(viewer, { text: RESOURCES_CSV })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(applyImport(viewer, { text: RESOURCES_CSV })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await createResource(globex, { name: "APP01", type: "SERVER" });
    const preview = await previewImport(acme, { text: RESOURCES_CSV });
    expect(preview.counts.create).toBe(2);
  });
});

describe("Docker Compose import", () => {
  it("creates containers and suggests depends_on relationships", async () => {
    const ctx = await ownerContext("Acme");
    const compose = `
services:
  web:
    image: nginx:1.27
    depends_on: [api]
  api:
    image: shop/api:2.1
    depends_on: [db]
  db:
    image: postgres:17
`;
    const result = await applyImport(ctx, { text: compose, project: "shop" });
    expect(result).toMatchObject({
      format: "docker-compose",
      created: 3,
      relationships: 2,
      suggestions: 2,
    });
    const containers = await listResources(ctx, { type: "CONTAINER" });
    expect(containers.map((c) => [c.name, c.externalId])).toEqual([
      ["api", "docker-compose:shop/api"],
      ["db", "docker-compose:shop/db"],
      ["web", "docker-compose:shop/web"],
    ]);
    const suggestions = await listSuggestions(ctx);
    expect(suggestions.map((s) => `${s.from.name} ${s.type} ${s.to.name}`).sort()).toEqual([
      "api DEPENDS_ON db",
      "web DEPENDS_ON api",
    ]);
    // Re-import is a no-op.
    expect(await applyImport(ctx, { text: compose, project: "shop" })).toMatchObject({
      created: 0,
      unchanged: 3,
      relationships: 0,
    });
  });
});

describe("platform export import (ADR-017 option A)", () => {
  it("imports a Proxmox inventory as DISCOVERED resources with confirmed HOSTS placement", async () => {
    const { getResourceImpact } = await import("@/server/modules/impact/impact");
    const ctx = await ownerContext("Acme");
    const pvesh = JSON.stringify([
      { id: "node/pve01", type: "node", node: "pve01", status: "online" },
      {
        id: "qemu/100",
        type: "qemu",
        node: "pve01",
        name: "APP-STG01",
        vmid: 100,
        status: "running",
      },
      {
        id: "lxc/101",
        type: "lxc",
        node: "pve01",
        name: "redis-cache",
        vmid: 101,
        status: "running",
      },
    ]);
    expect(await applyImport(ctx, { text: pvesh })).toMatchObject({
      format: "proxmox",
      created: 3,
      relationships: 2,
      suggestions: 0,
    });
    const node = (await listResources(ctx, { q: "pve01" }))[0]!;
    expect(node).toMatchObject({
      status: "DISCOVERED",
      source: "IMPORT",
      externalId: "proxmox:node/pve01",
    });
    const rels = await adminDb().relationship.findMany({});
    expect(
      rels.every((r) => r.origin === "DETECTED" && r.status === "CONFIRMED" && r.type === "HOSTS"),
    ).toBe(true);
    const impact = await getResourceImpact(ctx, node.id);
    expect(impact!.affected.map((a) => a.resource.name).sort()).toEqual([
      "APP-STG01",
      "redis-cache",
    ]);
    expect(impact!.affected.every((a) => a.confidence === "confirmed")).toBe(true);

    // The export is the source of truth for placement: re-import is a no-op.
    expect(await applyImport(ctx, { text: pvesh })).toMatchObject({
      created: 0,
      unchanged: 3,
      relationships: 0,
    });
  });
});
