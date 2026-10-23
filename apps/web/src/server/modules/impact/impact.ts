// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import {
  changeImpact,
  edgeConfidence,
  impact,
  summarizeImpact,
  type AffectedResource,
  type ChangeAffected,
  type CoveredResource,
  type DegradedGroup,
  type ImpactSummary,
} from "@depmap/graph";
import type { WorkspaceContext } from "@/server/authz";
import { getWorkspaceGraph, type MapEdge, type MapNode } from "@/server/modules/map/map";
import { redundancyGroups } from "@/lib/redundancy";

export const DEFAULT_IMPACT_DEPTH = 10;

export interface AffectedView extends AffectedResource {
  resource: MapNode;
  /** Names along the path, failing resource first. */
  pathNames: string[];
}

/** Would be affected, but another member of its redundancy group still serves it (M39). */
export interface CoveredView extends CoveredResource {
  resource: MapNode;
  pathNames: string[];
  /** The group's name as a member spells it. */
  groupName: string;
}

/** A redundancy group with some members down and some still up (M39). */
export interface DegradedView {
  groupName: string;
  down: MapNode[];
  up: MapNode[];
}

export interface ResourceImpact {
  root: MapNode;
  affected: AffectedView[];
  covered: CoveredView[];
  degraded: DegradedView[];
  summary: ImpactSummary;
}

/** Converts map edges to impact edges (IGNORED are already excluded by the map query). */
export function toImpactEdges(edges: readonly MapEdge[]) {
  return edges.map((e) => ({ ...e, confidence: edgeConfidence(e.status, e.origin) }));
}

/** Names the graph's covered resources and degraded groups. */
function redundancyViews(
  byId: ReadonlyMap<string, MapNode>,
  covered: readonly CoveredResource[],
  degraded: readonly DegradedGroup[],
) {
  const node = (id: string) => byId.get(id)!;
  const groupName = (members: readonly string[], key: string) =>
    members.map((id) => byId.get(id)?.redundancyGroup).find(Boolean) ?? key;
  const names = new Map(degraded.map((g) => [g.group, groupName([...g.down, ...g.up], g.group)]));
  return {
    covered: covered.map((c) => ({
      ...c,
      resource: node(c.resourceId),
      pathNames: c.path.map((id) => byId.get(id)?.name ?? "?"),
      groupName: names.get(c.group) ?? c.group,
    })),
    degraded: degraded.map((g) => ({
      groupName: names.get(g.group)!,
      down: g.down.map(node),
      up: g.up.map(node),
    })),
  };
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

  const result = impact(toImpactEdges(graph.edges), resourceId, {
    maxDepth,
    groups: redundancyGroups(graph.nodes),
  });
  const affected = result.affected.map((a) => ({
    ...a,
    resource: byId.get(a.resourceId)!,
    pathNames: a.path.map((id) => byId.get(id)?.name ?? "?"),
  }));
  return {
    root,
    affected,
    ...redundancyViews(byId, result.covered, result.degraded),
    summary: summarizeImpact(result, (id) => byId.get(id)!.type),
  };
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
  covered: CoveredView[];
  degraded: DegradedView[];
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
  const result = changeImpact(toImpactEdges(graph.edges), ids, {
    maxDepth,
    groups: redundancyGroups(graph.nodes),
  });
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
    ...redundancyViews(byId, result.covered, result.degraded),
    summary: summarizeImpact(result, (id) => byId.get(id)!.type),
  };
}
