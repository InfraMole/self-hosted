// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import { isBillable } from "@/lib/billing-plans";
import { assertCanAddNodes } from "@/server/modules/billing/limits";
import { Prisma, type Resource } from "@/generated/prisma/client";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { recordUserChange } from "@/server/modules/changes/changes";
import { diffResource, updateSummary, type ResourceSnapshot } from "./diff";
import {
  resourceFiltersSchema,
  resourceInputSchema,
  resourceLinkSchema,
  resourceMetadataSchema,
  type ResourceFilters,
  type ResourceLink,
  type ResourceMetadata,
} from "./schemas";

/** Library cap. Our scale target is ≤250 nodes per workspace. */
export const LIST_LIMIT = 500;
const MAX_ID_LENGTH = 64;

export class ResourceNotFoundError extends Error {
  constructor() {
    super("Resource not found");
    this.name = "ResourceNotFoundError";
  }
}

/** Resource with JSON columns parsed into their typed shapes. */
export type ResourceView = Omit<Resource, "links" | "metadata"> & {
  links: ResourceLink[];
  metadata: ResourceMetadata;
};

function toView(resource: Resource): ResourceView {
  const links = resourceLinkSchema.array().safeParse(resource.links);
  const metadata = resourceMetadataSchema.safeParse(resource.metadata);
  return {
    ...resource,
    links: links.success ? links.data : [],
    metadata: metadata.success ? metadata.data : {},
  };
}

function snapshot(r: Resource): ResourceSnapshot {
  return {
    name: r.name,
    type: r.type,
    environment: r.environment,
    criticality: r.criticality,
    status: r.status,
    description: r.description,
    notes: r.notes,
    tags: r.tags,
    links: r.links,
    metadata: r.metadata,
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

// ───────────────────────── Reads (any member) ─────────────────────────

export async function listResources(
  ctx: WorkspaceContext,
  rawFilters: unknown = {},
): Promise<ResourceView[]> {
  const filters: ResourceFilters = resourceFiltersSchema.parse(rawFilters);
  const where: Prisma.ResourceWhereInput = {
    workspaceId: ctx.workspaceId,
    type: filters.type,
    environment: filters.environment,
    // Archived resources are hidden unless explicitly requested.
    status: filters.status ?? { not: "ARCHIVED" },
    ...(filters.source ? { sourceRef: filters.source === "manual" ? null : filters.source } : {}),
  };
  if (filters.q) {
    const q = filters.q;
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { tags: { has: q.toLowerCase() } },
      { metadata: { path: ["hostname"], string_contains: q } },
      { metadata: { path: ["ipAddresses"], array_contains: [q] } },
    ];
  }
  const resources = await tenantDb(ctx).resource.findMany({
    where,
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    take: LIST_LIMIT,
  });
  return resources.map(toView);
}

export async function getResource(ctx: WorkspaceContext, id: string): Promise<ResourceView | null> {
  if (!id || id.length > MAX_ID_LENGTH) return null;
  const resource = await tenantDb(ctx).resource.findUnique({
    where: { workspaceId_id: { workspaceId: ctx.workspaceId, id } },
  });
  return resource ? toView(resource) : null;
}

// ───────────────────────── Writes (MEMBER+) ─────────────────────────

export async function createResource(
  ctx: WorkspaceContext,
  rawInput: unknown,
): Promise<ResourceView> {
  assertRole(ctx, "MEMBER");
  const input = resourceInputSchema.parse(rawInput);
  // Plan limit (ADR-019): only servers/VMs count.
  if (isBillable(input)) await assertCanAddNodes(ctx.workspaceId, 1);

  const resource = await tenantDb(ctx).$transaction(async (tx) => {
    const created = await tx.resource.create({
      data: { ...input, workspaceId: ctx.workspaceId, source: "MANUAL" },
    });
    await recordUserChange(tx, ctx, {
      subjectType: "RESOURCE",
      subjectId: created.id,
      subjectLabel: created.name,
      kind: "CREATED",
      summary: `Created ${created.name}`,
    });
    return created;
  });
  return toView(resource);
}

export async function updateResource(
  ctx: WorkspaceContext,
  id: string,
  rawInput: unknown,
): Promise<ResourceView> {
  assertRole(ctx, "MEMBER");
  const input = resourceInputSchema.parse(rawInput);
  if (!id || id.length > MAX_ID_LENGTH) throw new ResourceNotFoundError();
  const key = { workspaceId_id: { workspaceId: ctx.workspaceId, id } };

  const resource = await tenantDb(ctx).$transaction(async (tx) => {
    const before = await tx.resource.findUnique({ where: key });
    if (!before) throw new ResourceNotFoundError();
    // Becoming a billable node (e.g. unarchived, or APPLICATION → SERVER) counts as adding one.
    if (!isBillable(before) && isBillable(input)) await assertCanAddNodes(ctx.workspaceId, 1);
    // Ports are set by discovery (IIS bindings, M16) and not on the form: keep them.
    const kept = resourceMetadataSchema.safeParse(before.metadata);
    const ports = kept.success ? kept.data.ports : undefined;
    const after = await tx.resource.update({
      where: key,
      data: ports ? { ...input, metadata: { ...input.metadata, ports } } : input,
    });

    const diff = diffResource(snapshot(before), snapshot(after));
    if (Object.keys(diff).length > 0) {
      await recordUserChange(tx, ctx, {
        subjectType: "RESOURCE",
        subjectId: after.id,
        subjectLabel: after.name,
        kind: "UPDATED",
        summary: updateSummary(after.name, diff),
        diff: diff as Prisma.InputJsonValue,
      });
    }
    return after;
  });
  return toView(resource);
}

export async function deleteResource(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "MEMBER");
  if (!id || id.length > MAX_ID_LENGTH) throw new ResourceNotFoundError();

  try {
    await tenantDb(ctx).$transaction(async (tx) => {
      const deleted = await tx.resource.delete({
        where: { workspaceId_id: { workspaceId: ctx.workspaceId, id } },
      });
      await recordUserChange(tx, ctx, {
        subjectType: "RESOURCE",
        subjectId: deleted.id,
        subjectLabel: deleted.name,
        kind: "DELETED",
        summary: `Deleted ${deleted.name}`,
      });
    });
  } catch (error) {
    if (isNotFound(error)) throw new ResourceNotFoundError();
    throw error;
  }
}

// ───────────────────────── Bulk (MEMBER+) ─────────────────────────

export const BULK_LIMIT = 500;
const bulkIdsSchema = z.array(z.string().min(1).max(MAX_ID_LENGTH)).min(1).max(BULK_LIMIT);

/** Archives the given resources (reversible). Returns how many changed. */
export async function archiveResources(ctx: WorkspaceContext, rawIds: unknown): Promise<number> {
  assertRole(ctx, "MEMBER");
  const ids = bulkIdsSchema.parse(rawIds);
  return tenantDb(ctx).$transaction(
    async (tx) => {
      const rows = await tx.resource.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: ids }, status: { not: "ARCHIVED" } },
        select: { id: true, name: true, status: true },
      });
      for (const r of rows) {
        await tx.resource.update({ where: { id: r.id }, data: { status: "ARCHIVED" } });
        await recordUserChange(tx, ctx, {
          subjectType: "RESOURCE",
          subjectId: r.id,
          subjectLabel: r.name,
          kind: "UPDATED",
          summary: `Archived ${r.name}`,
          diff: { status: [r.status, "ARCHIVED"] },
        });
      }
      return rows.length;
    },
    { timeout: 60_000 },
  );
}

/** Deletes the given resources and their relationships. Returns how many were deleted. */
export async function deleteResources(ctx: WorkspaceContext, rawIds: unknown): Promise<number> {
  assertRole(ctx, "MEMBER");
  const ids = bulkIdsSchema.parse(rawIds);
  return tenantDb(ctx).$transaction(
    async (tx) => {
      const rows = await tx.resource.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: ids } },
        select: { id: true, name: true },
      });
      await tx.resource.deleteMany({
        where: { workspaceId: ctx.workspaceId, id: { in: rows.map((r) => r.id) } },
      });
      for (const r of rows)
        await recordUserChange(tx, ctx, {
          subjectType: "RESOURCE",
          subjectId: r.id,
          subjectLabel: r.name,
          kind: "DELETED",
          summary: `Deleted ${r.name}`,
        });
      return rows.length;
    },
    { timeout: 60_000 },
  );
}
