// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import {
  edgeConfidence,
  impact,
  summarizeImpact,
  type AffectedResource,
  type ImpactSummary,
} from "@depmap/graph";
import type { WorkspaceContext } from "@/server/authz";
import { getWorkspaceGraph, type MapEdge, type MapNode } from "@/server/modules/map/map";

export const DEFAULT_IMPACT_DEPTH = 10;

export interface AffectedView extends AffectedResource {
  resource: MapNode;
  /** Names along the path, failing resource first. */
  pathNames: string[];
}

export interface ResourceImpact {
  root: MapNode;
  affected: AffectedView[];
  summary: ImpactSummary;
}

/** Converts map edges to impact edges (IGNORED are already excluded by the map query). */
export function toImpactEdges(edges: readonly MapEdge[]) {
  return edges.map((e) => ({ ...e, confidence: edgeConfidence(e.status, e.origin) }));
}

/**
 * Potential blast radius of one resource, computed over the workspace graph
 * (archived resources and ignored relationships excluded). Returns null when
 * the resource is not in this workspace's graph.
 */
export async function getResourceImpact(
  ctx: WorkspaceContext,
  resourceId: string,
  maxDepth = DEFAULT_IMPACT_DEPTH,
): Promise<ResourceImpact | null> {
  const graph = await getWorkspaceGraph(ctx);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const root = byId.get(resourceId);
  if (!root) return null;

  const result = impact(toImpactEdges(graph.edges), resourceId, { maxDepth });
  const affected = result.affected.map((a) => ({
    ...a,
    resource: byId.get(a.resourceId)!,
    pathNames: a.path.map((id) => byId.get(id)?.name ?? "?"),
  }));
  return { root, affected, summary: summarizeImpact(result, (id) => byId.get(id)!.type) };
}
