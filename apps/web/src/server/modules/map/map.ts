// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type {
  Criticality,
  Environment,
  RelationshipOrigin,
  RelationshipStatus,
  RelationshipType,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";

export interface MapNode {
  id: string;
  name: string;
  type: ResourceType;
  environment: Environment | null;
  criticality: Criticality | null;
  status: ResourceStatus;
  ipAddresses: string[];
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  origin: RelationshipOrigin;
  status: RelationshipStatus;
  note: string | null;
}

export interface WorkspaceGraph {
  nodes: MapNode[];
  edges: MapEdge[];
}

/** Hard cap; our design ceiling is ~250 nodes per workspace. */
export const MAP_NODE_LIMIT = 1000;

/**
 * The whole workspace graph for the map. Archived resources and IGNORED
 * relationships are excluded (never drawn, never used for impact).
 */
export async function getWorkspaceGraph(ctx: WorkspaceContext): Promise<WorkspaceGraph> {
  const db = tenantDb(ctx);
  const [resources, relationships] = await Promise.all([
    db.resource.findMany({
      where: { workspaceId: ctx.workspaceId, status: { not: "ARCHIVED" } },
      select: {
        id: true,
        name: true,
        type: true,
        environment: true,
        criticality: true,
        status: true,
        metadata: true,
      },
      orderBy: { name: "asc" },
      take: MAP_NODE_LIMIT,
    }),
    db.relationship.findMany({
      where: { workspaceId: ctx.workspaceId, status: { not: "IGNORED" } },
      select: {
        id: true,
        fromResourceId: true,
        toResourceId: true,
        type: true,
        origin: true,
        status: true,
        note: true,
      },
    }),
  ]);

  const nodes = resources.map(({ metadata, ...r }) => {
    const parsed = resourceMetadataSchema.safeParse(metadata);
    return { ...r, ipAddresses: parsed.success ? (parsed.data.ipAddresses ?? []) : [] };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = relationships
    .filter((r) => ids.has(r.fromResourceId) && ids.has(r.toResourceId))
    .map((r) => ({
      id: r.id,
      from: r.fromResourceId,
      to: r.toResourceId,
      type: r.type,
      origin: r.origin,
      status: r.status,
      note: r.note,
    }));
  return { nodes, edges };
}
