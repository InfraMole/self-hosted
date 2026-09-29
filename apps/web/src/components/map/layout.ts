// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map layout (pure, unit tested). Layered top→bottom with dagre: dependents
 * above their dependencies, so reading the map downwards answers "what does
 * this need?" and upwards "what needs this?" (ADR-003).
 */
import dagre from "@dagrejs/dagre";
import { dependencyDirection, type GraphEdge } from "@depmap/graph";

export const NODE_WIDTH = 188;
export const NODE_HEIGHT = 40;

export interface Point {
  x: number;
  y: number;
}

/** Draw direction for an edge: dependent → dependency, or stored direction for informational edges. */
export function drawDirection(edge: GraphEdge): { source: string; target: string } {
  const dir = dependencyDirection(edge);
  return dir
    ? { source: dir.dependent, target: dir.dependency }
    : { source: edge.from, target: edge.to };
}

/** Top-left positions for each node id. */
export function layoutGraph(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
): Map<string, Point> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodeIds);
  for (const id of nodeIds) g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) {
    const { source, target } = drawDirection(edge);
    if (!ids.has(source) || !ids.has(target)) continue;
    // Informational edges should not pull layers apart.
    const informational = dependencyDirection(edge) === null;
    g.setEdge(source, target, { weight: informational ? 0 : 1, minlen: 1 }, edge.id);
  }

  dagre.layout(g);

  const positions = new Map<string, Point>();
  for (const id of nodeIds) {
    const n = g.node(id);
    positions.set(id, { x: n.x - NODE_WIDTH / 2, y: n.y - NODE_HEIGHT / 2 });
  }
  return positions;
}
