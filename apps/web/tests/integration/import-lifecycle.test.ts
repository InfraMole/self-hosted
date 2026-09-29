// SPDX-License-Identifier: AGPL-3.0-only
/** Lifecycle of imported resources (M10, ADR-021): provenance and reconciliation. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import { applyImport } from "@/server/modules/importers/importers";
import {
  createIntegration,
  deleteIntegration,
  syncIntegration,
} from "@/server/modules/integrations/integrations";
import { createRelationship } from "@/server/modules/relationships/relationships";
import { listSources, retireSource } from "@/server/modules/resources/sources";
import type { ProviderDeps } from "@/server/modules/integrations/providers";
import {
  archiveResources,
  createResource,
  deleteResources,
  updateResource,
} from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

const TOKEN = "cf_secret_token_1234567890abcd";
let records: { name: string; type: string; content: string; proxied: boolean }[] = [];
const cloudflare: ProviderDeps = {
  http: async (url) => {
    const body = url.includes("/dns_records")
      ? { success: true, result: records, result_info: { total_pages: 1 } }
      : {
          success: true,
          result: [{ id: "z1", name: "example.com" }],
          result_info: { total_pages: 1 },
        };
    return { status: 200, headers: new Headers(), text: JSON.stringify(body) };
  },
};
const dns = (...names: string[]) =>
  names.map((n) => ({
    name: `${n}.example.com`,
    type: "A",
    content: "198.51.100.1",
    proxied: false,
  }));

async function setup(): Promise<{ ctx: WorkspaceContext; integrationId: string }> {
  const user = await createTestUser("Owner");
  const ws = await createWorkspace(user.id, { name: "Acme" });
  const ctx = (await findWorkspaceContextForUser(user.id, ws.slug))!;
  const { id } = await createIntegration(ctx, {
    kind: "CLOUDFLARE",
    name: "CF",
    config: {},
    secret: { apiToken: TOKEN },
  });
  return { ctx, integrationId: id };
}

const statusOf = async (workspaceId: string) =>
  Object.fromEntries(
    (
      await adminDb().resource.findMany({
        where: { workspaceId },
        select: { name: true, status: true },
      })
    ).map((r) => [r.name, r.status]),
  );

describe("provenance", () => {
  it("records who created a resource, and never takes over one that already existed", async () => {
    const { ctx, integrationId } = await setup();
    await createResource(ctx, { name: "www.example.com", type: "DOMAIN" }); // a person made this one
    records = dns("app", "www");
    await syncIntegration(ctx, integrationId, cloudflare);
    const rows = await adminDb().resource.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { name: "asc" },
    });
    expect(rows.map((r) => [r.name, r.sourceRef, r.sourceLabel])).toEqual([
      ["app.example.com", `integration:${integrationId}`, "Cloudflare “CF”"],
      ["www.example.com", null, null],
    ]);
    await applyImport(ctx, { text: "name,type\nNAS01,storage", format: "csv" });
    expect(
      (await adminDb().resource.findFirstOrThrow({ where: { name: "NAS01" } })).sourceRef,
    ).toBe("file:csv");
  });
});

describe("reconciliation", () => {
  it("stales what is no longer reported, restores what comes back, never deletes", async () => {
    const { ctx, integrationId } = await setup();
    await createResource(ctx, { name: "www.example.com", type: "DOMAIN" });
    records = dns("app", "api", "mail", "www");
    await syncIntegration(ctx, integrationId, cloudflare);

    records = dns("app", "mail"); // api removed at the provider; www is not the integration's
    const out = await syncIntegration(ctx, integrationId, cloudflare);
    expect(out.message).toContain("1 no longer reported (stale)");
    expect(await statusOf(ctx.workspaceId)).toMatchObject({
      "app.example.com": "DISCOVERED",
      "api.example.com": "STALE",
      "mail.example.com": "DISCOVERED",
      "www.example.com": "ACTIVE", // owned by a person: untouched
    });
    const event = await adminDb().changeEvent.findFirst({ where: { kind: "NO_LONGER_OBSERVED" } });
    expect(event?.summary).toBe("api.example.com is no longer reported by Cloudflare “CF”");

    records = dns("app", "api", "mail");
    expect((await syncIntegration(ctx, integrationId, cloudflare)).message).toContain(
      "1 reported again",
    );
    expect((await statusOf(ctx.workspaceId))["api.example.com"]).toBe("DISCOVERED");
    expect(await adminDb().resource.count({ where: { workspaceId: ctx.workspaceId } })).toBe(4);
  });

  it("skips reconciliation when a sync looks partial", async () => {
    const { ctx, integrationId } = await setup();
    records = dns("a", "b", "c", "d", "e", "f", "g", "h");
    await syncIntegration(ctx, integrationId, cloudflare);
    records = dns("a", "b"); // 6 of 8 missing: probably a truncated response
    const out = await syncIntegration(ctx, integrationId, cloudflare);
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/6 of 8 resources were missing .* not marked stale/);
    expect(Object.values(await statusOf(ctx.workspaceId)).every((s) => s === "DISCOVERED")).toBe(
      true,
    );
  });

  it("uploaded files are not snapshots: nothing is staled by a later file", async () => {
    const { ctx } = await setup();
    await applyImport(ctx, { text: "name,type\nA,server\nB,server", format: "csv" });
    await applyImport(ctx, { text: "name,type\nA,server", format: "csv" });
    expect(await statusOf(ctx.workspaceId)).toMatchObject({ A: "ACTIVE", B: "ACTIVE" });
  });
});

describe("retirement", () => {
  it("deleting an integration can retire what it created: untouched deleted, touched archived", async () => {
    const { ctx, integrationId } = await setup();
    await createResource(ctx, { name: "www.example.com", type: "DOMAIN" }); // a person's
    records = dns("app", "api", "mail", "www");
    await syncIntegration(ctx, integrationId, cloudflare);
    const byName = async (n: string) => adminDb().resource.findFirstOrThrow({ where: { name: n } });
    const api = await byName("api.example.com");
    await updateResource(ctx, api.id, {
      name: api.name,
      type: "DOMAIN",
      notes: "public API, owned by team X",
    });
    const mail = await byName("mail.example.com");
    const web = await createResource(ctx, { name: "WEB01", type: "SERVER" });
    await createRelationship(ctx, {
      fromResourceId: web.id,
      toResourceId: mail.id,
      type: "DEPENDS_ON",
    });

    await expect(retireSource(ctx, `integration:${integrationId}`)).rejects.toThrow(
      /Delete the integration first/,
    );
    expect(await deleteIntegration(ctx, integrationId, { retire: true })).toEqual({
      deleted: 1,
      archived: 2,
    });
    expect(await statusOf(ctx.workspaceId)).toEqual({
      "api.example.com": "ARCHIVED",
      "mail.example.com": "ARCHIVED",
      "www.example.com": "ACTIVE",
      WEB01: "ACTIVE",
    });
    expect(
      await adminDb().auditEvent.findFirst({ where: { action: "workspace.source_retired" } }),
    ).toMatchObject({
      targetLabel: "Cloudflare “CF”",
      metadata: { deleted: 1, archived: 2 },
    });
  });

  it("sources removed before M10 (backfilled) are listed as removed and can be retired", async () => {
    const { ctx } = await setup();
    await adminDb().resource.createMany({
      data: ["a.example.com", "b.example.com"].map((name) => ({
        workspaceId: ctx.workspaceId,
        name,
        type: "DOMAIN" as const,
        status: "DISCOVERED" as const,
        source: "IMPORT" as const,
        sourceRef: "integration-removed:CF",
        sourceLabel: "Integration “CF”",
      })),
    });
    const [source] = await listSources(ctx);
    expect(source).toMatchObject({
      ref: "integration-removed:CF",
      removed: true,
      total: 2,
      kind: "integration",
    });
    expect(await retireSource(ctx, "integration-removed:CF")).toEqual({ deleted: 2, archived: 0 });
    expect(await listSources(ctx)).toEqual([]);
  });

  it("viewers cannot retire", async () => {
    const { ctx } = await setup();
    const viewer = await createTestUser("Viewer");
    await adminDb().membership.create({
      data: { workspaceId: ctx.workspaceId, userId: viewer.id, role: "VIEWER" },
    });
    const vctx = (await findWorkspaceContextForUser(viewer.id, ctx.workspaceSlug))!;
    await expect(retireSource(vctx, "file:csv")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("bulk archive / delete", () => {
  it("acts only on the workspace's own resources, records changes, and needs MEMBER", async () => {
    const { ctx } = await setup();
    const other = await setup();
    const mine = await Promise.all(
      ["A", "B", "C"].map((n) => createResource(ctx, { name: n, type: "SERVER" })),
    );
    const theirs = await createResource(other.ctx, { name: "X", type: "SERVER" });

    expect(await archiveResources(ctx, [mine[0]!.id, theirs.id])).toBe(1);
    expect(await deleteResources(ctx, [mine[1]!.id, theirs.id])).toBe(1);
    expect(await statusOf(ctx.workspaceId)).toEqual({ A: "ARCHIVED", C: "ACTIVE" });
    expect(await statusOf(other.ctx.workspaceId)).toEqual({ X: "ACTIVE" });
    expect(
      await adminDb().changeEvent.count({
        where: { workspaceId: ctx.workspaceId, actorType: "USER", kind: "DELETED" },
      }),
    ).toBe(1);

    await expect(deleteResources(ctx, [])).rejects.toThrow();
    await expect(
      deleteResources(
        ctx,
        Array.from({ length: 501 }, (_, i) => `id${i}`),
      ),
    ).rejects.toThrow();
    const viewer = await createTestUser("Viewer");
    await adminDb().membership.create({
      data: { workspaceId: ctx.workspaceId, userId: viewer.id, role: "VIEWER" },
    });
    const vctx = (await findWorkspaceContextForUser(viewer.id, ctx.workspaceSlug))!;
    await expect(archiveResources(vctx, [mine[2]!.id])).rejects.toBeInstanceOf(ForbiddenError);
  });
});
