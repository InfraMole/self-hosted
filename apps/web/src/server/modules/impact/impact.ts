// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import {
  changeImpact,
  edgeConfidence,
  impact,
  summarizeImpact,
  type AffectedResource,
  type ChangeAffected,
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

export interface ChangeAffectedView extends ChangeAffected {
  resource: MapNode;
  pathNames: string[];
  causeNames: string[];
}

export interface ChangeImpact {
  /** The changed resources found in this workspace's graph, in the order given. */
  changed: MapNode[];
  /** Ids given that are not in the graph (other workspace, archived, deleted). */
  missing: number;
  affected: ChangeAffectedView[];
  summary: ImpactSummary;
}

/**
 * Combined blast radius of several resources changing together (M34). Only
 * resources of this workspace's graph count: other ids are reported as
 * missing, never looked up elsewhere.
 */
export async function getChangeImpact(
  ctx: WorkspaceContext,
  resourceIds: readonly string[],
  maxDepth = DEFAULT_IMPACT_DEPTH,
): Promise<ChangeImpact> {
  const graph = await getWorkspaceGraph(ctx);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ids = [...new Set(resourceIds)].filter((id) => byId.has(id));
  const result = changeImpact(toImpactEdges(graph.edges), ids, { maxDepth });
  const name = (id: string) => byId.get(id)?.name ?? "?";
  const affected = result.affected.map((a) => ({
    ...a,
    resource: byId.get(a.resourceId)!,
    pathNames: a.path.map(name),
    causeNames: a.causes.map(name),
  }));
  return {
    changed: result.rootIds.map((id) => byId.get(id)!),
    missing: new Set(resourceIds).size - ids.length,
    affected,
    summary: summarizeImpact(result, (id) => byId.get(id)!.type),
  };
}
