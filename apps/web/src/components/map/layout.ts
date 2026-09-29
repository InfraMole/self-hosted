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

/**
 * Above this many visible nodes dagre's crossing reduction is too slow for a
 * browser (load test, M15: 0.5 s at 250 nodes, 22 s at 1,000, 58 s at 2,000),
 * so the map switches to `layeredLayout` and says the layout is simplified.
 */
export const DETAILED_LAYOUT_LIMIT = 300;

/** Top-left positions for each node id (dagre up to DETAILED_LAYOUT_LIMIT nodes). */
export function layoutGraph(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
): Map<string, Point> {
  if (nodeIds.length > DETAILED_LAYOUT_LIMIT) return layeredLayout(nodeIds, edges);
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
  return wrapWideLayers(positions);
}

/**
 * A hub (a domain controller, a shared database) can have dozens of
 * dependents in one layer: one very long row that the map can only fit by
 * zooming out until nothing is readable. Wrap such layers into rows of
 * MAX_ROW, keeping their left-to-right order, and push lower layers down.
 */
export function wrapWideLayers(positions: Map<string, Point>): Map<string, Point> {
  const layers = new Map<number, string[]>();
  for (const [id, p] of positions) layers.set(p.y, [...(layers.get(p.y) ?? []), id]);
  if ([...layers.values()].every((l) => l.length <= MAX_ROW)) return positions;

  // Once a layer wraps, dagre's horizontal alignment no longer holds: centre
  // every row on one axis so the map stays compact (order is kept).
  const out = new Map<string, Point>();
  let y = Math.min(...layers.keys());
  for (const layerY of [...layers.keys()].sort((a, b) => a - b)) {
    const ids = layers.get(layerY)!.sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (let start = 0; start < ids.length; start += MAX_ROW) {
      const row = ids.slice(start, start + MAX_ROW);
      const width = row.length * NODE_WIDTH + (row.length - 1) * GAP_X;
      row.forEach((id, i) => out.set(id, { x: -width / 2 + i * (NODE_WIDTH + GAP_X), y }));
      y += NODE_HEIGHT + ROW_GAP;
    }
    y += GAP_Y - ROW_GAP;
  }
  return out;
}

const GAP_X = 28;
const GAP_Y = 64;
const ROW_GAP = 16;
/** Wide layers wrap into rows of this many nodes so the map stays readable. */
export const MAX_ROW = 16;

/**
 * Fast layered layout for large maps (M15), linear in nodes + edges:
 * longest-path layers (dependents above dependencies, cycles broken by DFS),
 * two barycenter sweeps to reduce crossings, wide layers wrapped into rows.
 * Less polished than dagre, but a 2,000-server map lays out in milliseconds.
 */
export function layeredLayout(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
): Map<string, Point> {
  const ids = new Set(nodeIds);
  const down = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const up = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const edge of edges) {
    if (dependencyDirection(edge) === null) continue; // informational: no layering
    const { source, target } = drawDirection(edge);
    if (!ids.has(source) || !ids.has(target) || source === target) continue;
    down.get(source)!.push(target);
    up.get(target)!.push(source);
  }

  // Break cycles: keep only edges that do not close a cycle in a DFS (iterative).
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const dag = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const root of nodeIds) {
    if (state.has(root)) continue;
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const children = down.get(top[0])!;
      if (top[1] < children.length) {
        const child = children[top[1]++]!;
        const s = state.get(child);
        if (s === 1) continue; // back edge
        dag.get(top[0])!.push(child);
        if (!s) {
          state.set(child, 1);
          stack.push([child, 0]);
        }
      } else {
        state.set(top[0], 2);
        stack.pop();
      }
    }
  }

  // Longest-path layers over the DAG (Kahn order).
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const targets of dag.values())
    for (const t of targets) indegree.set(t, indegree.get(t)! + 1);
  const layer = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const t of dag.get(id)!) {
      layer.set(t, Math.max(layer.get(t)!, layer.get(id)! + 1));
      indegree.set(t, indegree.get(t)! - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }

  const layers: string[][] = [];
  for (const id of nodeIds) (layers[layer.get(id)!] ??= []).push(id);
  const dense = layers.filter((l) => l && l.length > 0);

  // Barycenter sweeps: order each layer by the mean position of its neighbours.
  const order = new Map<string, number>();
  const index = () => dense.forEach((l) => l.forEach((id, i) => order.set(id, i / l.length)));
  index();
  const sweep = (layerIds: string[], neighbours: Map<string, string[]>) => {
    const score = new Map(
      layerIds.map((id) => {
        const ns = neighbours.get(id)!.filter((n) => order.has(n));
        return [
          id,
          ns.length ? ns.reduce((a, n) => a + order.get(n)!, 0) / ns.length : order.get(id)!,
        ];
      }),
    );
    layerIds.sort((a, b) => score.get(a)! - score.get(b)!);
    layerIds.forEach((id, i) => order.set(id, i / layerIds.length));
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < dense.length; i++) sweep(dense[i]!, up);
    for (let i = dense.length - 2; i >= 0; i--) sweep(dense[i]!, down);
  }

  // Place: each layer wraps into rows of MAX_ROW, centred.
  const positions = new Map<string, Point>();
  const width = (count: number) => count * NODE_WIDTH + (count - 1) * GAP_X;
  const maxWidth = width(Math.min(MAX_ROW, Math.max(...dense.map((l) => l.length), 1)));
  let y = 16;
  for (const l of dense) {
    for (let start = 0; start < l.length; start += MAX_ROW) {
      const row = l.slice(start, start + MAX_ROW);
      const x0 = 16 + (maxWidth - width(row.length)) / 2;
      row.forEach((id, i) => positions.set(id, { x: x0 + i * (NODE_WIDTH + GAP_X), y }));
      y += NODE_HEIGHT + ROW_GAP;
    }
    y += GAP_Y - ROW_GAP;
  }
  return positions;
}
