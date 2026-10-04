// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a map view shows (M31, ADR-045): the same pure functions run in the
 * map (components/map/map-view.tsx) and on the server for a public share
 * link, which must send only what the view shows. Client-safe.
 */
import {
  dependencyDirection,
  edgeConfidence,
  impact,
  neighbourhood,
  type Direction,
  type RelationshipOrigin,
  type RelationshipStatus,
  type RelationshipType,
} from "@depmap/graph";

export interface SubsetNode {
  id: string;
  type: string;
  environment: string | null;
}

export interface SubsetEdge {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  status: RelationshipStatus;
  origin: RelationshipOrigin;
}

export interface SubsetFocus {
  id: string;
  depth: number;
  direction: Direction;
}

/** Edges the toggles allow; in impact view every propagating edge, in path view only the path. */
export function candidateEdgesOf<E extends SubsetEdge>(
  edges: readonly E[],
  options: {
    showUnconfirmed: boolean;
    showInformational: boolean;
    impact: boolean;
    pathEdgeIds?: ReadonlySet<string> | null;
  },
): E[] {
  return edges.filter((e) => {
    const confidence = edgeConfidence(e.status, e.origin);
    if (!confidence) return false;
    if (options.pathEdgeIds) return options.pathEdgeIds.has(e.id);
    // Impact mode shows every propagating edge (confidence is drawn, not filtered).
    if (options.impact) return dependencyDirection(e) !== null;
    if (confidence !== "confirmed" && !options.showUnconfirmed) return false;
    if (!options.showInformational && dependencyDirection(e) === null) return false;
    return true;
  });
}

/** Ids of the resources a view shows, in the order of `nodes`. */
export function visibleIdsOf(
  nodes: readonly SubsetNode[],
  candidateEdges: readonly SubsetEdge[],
  options: {
    type: string | null;
    environment: string | null;
    showInformational: boolean;
    focus: SubsetFocus | null;
    /** Impact view: the failing resource and what could be affected. */
    impactIds?: ReadonlySet<string> | null;
    /** Path view: the chain between two resources. */
    path?: readonly string[] | null;
  },
): string[] {
  if (options.path) return [...options.path];
  if (options.impactIds) return nodes.filter((n) => options.impactIds!.has(n.id)).map((n) => n.id);
  const focus = options.focus;
  const hood =
    focus && nodes.some((n) => n.id === focus.id)
      ? neighbourhood(candidateEdges, focus.id, {
          depth: focus.depth,
          direction: focus.direction,
          // Informational links are context for the focus itself, only in "both" view.
          includeRelated: options.showInformational && focus.direction === "both",
        })
      : null;
  return nodes
    .filter((n) => {
      if (hood) {
        if (!hood.has(n.id)) return false;
        if (n.id === focus?.id) return true; // the focus is always shown
      }
      return (
        (!options.type || n.type === options.type) &&
        (!options.environment || n.environment === options.environment)
      );
    })
    .map((n) => n.id);
}

/**
 * Applies a saved view's filters, focus or impact to a graph: the resources
 * and relationships it shows, nothing else. Ids the graph no longer has are
 * ignored.
 */
export function viewSubset<N extends SubsetNode, E extends SubsetEdge>(
  nodes: readonly N[],
  edges: readonly E[],
  state: {
    type: string | null;
    environment: string | null;
    showUnconfirmed: boolean;
    showInformational: boolean;
    focus: SubsetFocus | null;
    impact: string | null;
  },
): { nodes: N[]; edges: E[] } {
  const ids = new Set(nodes.map((n) => n.id));
  let impactIds: Set<string> | null = null;
  if (state.impact && ids.has(state.impact)) {
    const withConfidence = edges.map((e) => ({
      ...e,
      confidence: edgeConfidence(e.status, e.origin),
    }));
    const result = impact(withConfidence, state.impact);
    impactIds = new Set([state.impact, ...result.affected.map((a) => a.resourceId)]);
  }
  const candidates = candidateEdgesOf(edges, {
    showUnconfirmed: state.showUnconfirmed,
    showInformational: state.showInformational,
    impact: impactIds !== null,
  });
  const visible = new Set(
    visibleIdsOf(nodes, candidates, {
      type: state.type,
      environment: state.environment,
      showInformational: state.showInformational,
      focus: state.focus && ids.has(state.focus.id) ? state.focus : null,
      impactIds,
    }),
  );
  return {
    nodes: nodes.filter((n) => visible.has(n.id)),
    edges: candidates.filter((e) => visible.has(e.from) && visible.has(e.to)),
  };
}
