// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import {
  RELATIONSHIP_TYPE_INFO,
  dependencyDirection,
  describePath,
  edgeConfidence,
  findPath,
  pathSteps,
} from "@depmap/graph";
import { z } from "zod";
import type { Prisma, Relationship, Resource } from "@/generated/prisma/client";
import { Environment, ResourceStatus, ResourceType } from "@/generated/prisma/enums";
import { RELATIONSHIP_TYPES } from "@depmap/graph";
import { notifyList } from "@/lib/notify";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import {
  DEFAULT_IMPACT_DEPTH,
  getResourceImpact,
  toImpactEdges,
} from "@/server/modules/impact/impact";
import { getWorkspaceGraph } from "@/server/modules/map/map";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";

/**
 * Read model of the read-only API (M30, ADR-044, docs reference/api). Every
 * function takes the token's WorkspaceContext and reads through tenantDb.
 * The JSON shapes here are the public contract of /api/v1: add fields
 * freely, never rename or remove one without a new version.
 */

export const API_PAGE_MAX = 500;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const page = {
  limit: z.coerce.number().int().min(1).max(API_PAGE_MAX).default(100),
  cursor: id.optional(),
};

export class ApiNotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "ApiNotFoundError";
  }
}

// ───────────────────────── Shapes ─────────────────────────

export function toApiResource(r: Resource) {
  const meta = resourceMetadataSchema.safeParse(r.metadata);
  const m = meta.success ? meta.data : {};
  const links = z.array(z.object({ label: z.string(), url: z.string() })).safeParse(r.links);
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    environment: r.environment,
    criticality: r.criticality,
    description: r.description,
    notes: r.notes,
    owner: r.owner,
    ownerContact: r.ownerContact,
    tags: r.tags,
    hostname: m.hostname ?? null,
    fqdn: m.fqdn ?? null,
    os: m.os ?? null,
    version: m.version ?? null,
    ipAddresses: m.ipAddresses ?? [],
    ports: m.ports ?? [],
    links: links.success ? links.data : [],
    source: r.source,
    sourceLabel: r.sourceLabel,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type Ref = { id: string; name: string; type: ResourceType };

function toApiRelationship(r: Relationship, from: Ref, to: Ref) {
  const dir = dependencyDirection({
    id: r.id,
    from: r.fromResourceId,
    to: r.toResourceId,
    type: r.type,
  });
  return {
    id: r.id,
    type: r.type,
    /** "<from> <label> <to>", e.g. "Billing uses database CustomersDB". */
    label: RELATIONSHIP_TYPE_INFO[r.type].label,
    from,
    to,
    status: r.status,
    origin: r.origin,
    /** confirmed | detected | inferred — never treat the last two as certain. */
    confidence: edgeConfidence(r.status, r.origin),
    /** Which end depends on which (null: this type does not propagate failure). */
    dependency: dir ? { dependent: dir.dependent, dependency: dir.dependency } : null,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  };
}

const refSelect = { id: true, name: true, type: true } as const;

// ───────────────────────── Workspace ─────────────────────────

export async function apiWorkspace(ctx: WorkspaceContext) {
  const db = tenantDb(ctx);
  const [resources, relationships] = await Promise.all([
    db.resource.count({ where: { workspaceId: ctx.workspaceId, status: { not: "ARCHIVED" } } }),
    db.relationship.count({ where: { workspaceId: ctx.workspaceId, status: { not: "IGNORED" } } }),
  ]);
  return {
    id: ctx.workspaceId,
    name: ctx.workspaceName,
    slug: ctx.workspaceSlug,
    resources,
    relationships,
  };
}

// ───────────────────────── Resources ─────────────────────────

export const apiResourcesQuery = z.object({
  type: z.enum(ResourceType).optional(),
  environment: z.enum(Environment).optional(),
  /** Archived resources only when asked for. */
  status: z.enum(ResourceStatus).optional(),
  tag: z.string().trim().toLowerCase().min(1).max(64).optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  /** Name contains (case-insensitive). */
  q: z.string().trim().min(1).max(200).optional(),
  ...page,
});

export async function apiListResources(ctx: WorkspaceContext, raw: unknown) {
  const query = apiResourcesQuery.parse(raw);
  const where: Prisma.ResourceWhereInput = {
    workspaceId: ctx.workspaceId,
    type: query.type,
    environment: query.environment,
    status: query.status ?? { not: "ARCHIVED" },
    // Keyset pagination: ids sort stably, and a cursor deleted meanwhile still works.
    ...(query.cursor ? { id: { gt: query.cursor } } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.owner ? { owner: { equals: query.owner, mode: "insensitive" } } : {}),
    ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
  };
  const rows = await tenantDb(ctx).resource.findMany({
    where,
    orderBy: { id: "asc" },
    take: query.limit + 1,
  });
  const more = rows.length > query.limit;
  const data = rows.slice(0, query.limit).map(toApiResource);
  return { data, next: more ? data.at(-1)!.id : null };
}

export async function apiGetResource(ctx: WorkspaceContext, resourceId: string) {
  if (!id.safeParse(resourceId).success) throw new ApiNotFoundError("Resource not found");
  const db = tenantDb(ctx);
  const resource = await db.resource.findUnique({
    where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: resourceId } },
  });
  if (!resource) throw new ApiNotFoundError("Resource not found");
  const relationships = await db.relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: { not: "IGNORED" },
      OR: [{ fromResourceId: resourceId }, { toResourceId: resourceId }],
    },
    include: { from: { select: refSelect }, to: { select: refSelect } },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  return {
    ...toApiResource(resource),
    relationships: relationships.map(({ from, to, ...r }) => toApiRelationship(r, from, to)),
  };
}

// ───────────────────────── Relationships ─────────────────────────

export const apiRelationshipsQuery = z.object({
  /** Default: everything except ignored. */
  status: z.enum(["CONFIRMED", "UNCONFIRMED", "IGNORED"]).optional(),
  type: z.enum(RELATIONSHIP_TYPES).optional(),
  /** Relationships of one resource (either end). */
  resource: id.optional(),
  ...page,
});

export async function apiListRelationships(ctx: WorkspaceContext, raw: unknown) {
  const query = apiRelationshipsQuery.parse(raw);
  const rows = await tenantDb(ctx).relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: query.status ?? { not: "IGNORED" },
      type: query.type,
      ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      ...(query.resource
        ? { OR: [{ fromResourceId: query.resource }, { toResourceId: query.resource }] }
        : {}),
    },
    include: { from: { select: refSelect }, to: { select: refSelect } },
    orderBy: { id: "asc" },
    take: query.limit + 1,
  });
  const more = rows.length > query.limit;
  const data = rows
    .slice(0, query.limit)
    .map(({ from, to, ...r }) => toApiRelationship(r, from, to));
  return { data, next: more ? data.at(-1)!.id : null };
}

// ───────────────────────── Impact ─────────────────────────

export const apiImpactQuery = z.object({
  depth: z.coerce.number().int().min(1).max(DEFAULT_IMPACT_DEPTH).default(DEFAULT_IMPACT_DEPTH),
});

export async function apiImpact(ctx: WorkspaceContext, resourceId: string, raw: unknown) {
  const { depth } = apiImpactQuery.parse(raw);
  if (!id.safeParse(resourceId).success) throw new ApiNotFoundError("Resource not found");
  const result = await getResourceImpact(ctx, resourceId, depth);
  if (!result) throw new ApiNotFoundError("Resource not found (or archived)");
  const ref = (n: { id: string; name: string; type: ResourceType }) => ({
    id: n.id,
    name: n.name,
    type: n.type,
  });
  const warn = notifyList(
    result.affected.map((a) => ({
      name: a.resource.name,
      owner: a.resource.owner,
      ownerContact: a.resource.ownerContact,
      confidence: a.confidence,
    })),
  );
  return {
    resource: ref(result.root),
    /** What could be affected if it went down — "could", never "will". */
    affected: result.affected.map((a) => ({
      resource: ref(a.resource),
      depth: a.depth,
      confidence: a.confidence,
      path: a.path.map((pid, i) => ({ id: pid, name: a.pathNames[i]! })),
      relationships: a.viaEdges,
      owner: a.resource.owner,
      ownerContact: a.resource.ownerContact,
    })),
    summary: result.summary,
    whoToWarn: {
      owners: warn.groups.map((g) => ({
        owner: g.owner,
        contact: g.contact,
        resources: g.resources.map((r) => r.name),
      })),
      withoutOwner: warn.unowned,
    },
  };
}

// ───────────────────────── Path ─────────────────────────

export const apiPathQuery = z.object({ from: id, to: id });

/** How two resources are linked; `data: null` when they are not. */
export async function apiPath(ctx: WorkspaceContext, raw: unknown) {
  const query = apiPathQuery.parse(raw);
  const graph = await getWorkspaceGraph(ctx);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const end of [query.from, query.to])
    if (!byId.has(end)) throw new ApiNotFoundError(`Resource ${end} not found (or archived)`);
  const edges = toImpactEdges(graph.edges);
  const result = findPath(edges, query.from, query.to);
  if (!result) return null;
  const name = (pid: string) => byId.get(pid)!.name;
  return {
    kind: result.kind,
    confidence: result.confidence,
    path: result.path.map((pid) => {
      const n = byId.get(pid)!;
      return { id: n.id, name: n.name, type: n.type };
    }),
    steps: pathSteps(result, edges).map((s) => ({
      from: s.from,
      to: s.to,
      relationship: s.edgeId,
      phrase: s.phrase,
      confidence: s.confidence,
    })),
    text: describePath(result, edges, name),
  };
}
