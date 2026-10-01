// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map layout (pure, unit tested; M26, ADR-039). A layered "stack" read top
 * to bottom: entry points (CDN, domains, load balancers) → applications →
 * services → data → compute → hosts. Each resource sits on the layer of its
 * type or lower, never above what depends on it, so arrows point down
 * ("what does this need?") — except "exposed through", drawn from below up
 * to the proxy that fronts it (the path a request takes).
 *
 * Connected groups are laid out separately and packed to a screen-like
 * shape; resources without relationships go to a tray. Linear-ish in nodes
 * + edges: 2,000 servers lay out in well under a second.
 */
import { dependencyDirection, type GraphEdge } from "@depmap/graph";
import type { ResourceType } from "@/generated/prisma/enums";

export const NODE_WIDTH = 212;
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

/** Edge types whose arrow points up (to the entry point above). */
export const UPWARD_EDGE_TYPES: ReadonlySet<string> = new Set(["EXPOSED_THROUGH"]);

/**
 * The highest layer a type may sit on (it moves lower when what depends on
 * it is lower). Same-type resources line up; the stack reads the same on
 * every map.
 */
export const TYPE_LAYER: Record<ResourceType, number> = {
  EXTERNAL_SERVICE: 0,
  OTHER: 0,
  DOMAIN: 1,
  NETWORK: 2,
  APPLICATION: 3,
  API: 3,
  WINDOWS_SERVICE: 4,
  LINUX_SERVICE: 4,
  DATABASE: 5,
  STORAGE: 5,
  CONTAINER: 6,
  VM: 6,
  SERVER: 7,
};

/**
 * Above this many visible nodes the map renders only what is on screen
 * (React Flow `onlyRenderVisibleElements`).
 */
export const DETAILED_LAYOUT_LIMIT = 300;

/** Wide layers wrap into rows of this many nodes so the map stays readable. */
export const MAX_ROW = 16;

const GAP_X = 28;
const GAP_Y = 72;
const ROW_GAP = 18;
const COMPONENT_GAP = 140;
const TRAY_COLUMNS = 6;
const SPACING = NODE_WIDTH + GAP_X;

export interface MapLayout {
  positions: Map<string, Point>;
  /** Node ids of the largest connected group: where a large map opens. */
  primary: string[];
}

/** Top-left positions for each node id. */
export function layoutGraph(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  types?: ReadonlyMap<string, ResourceType>,
): Map<string, Point> {
  return stackLayout(nodeIds, edges, types).positions;
}

/** "above" must be drawn on a higher layer than "below", or null (no layering). */
function layering(edge: GraphEdge): [above: string, below: string] | null {
  if (UPWARD_EDGE_TYPES.has(edge.type)) return [edge.to, edge.from];
  const dir = dependencyDirection(edge);
  return dir ? [dir.dependent, dir.dependency] : null;
}

export function stackLayout(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  types?: ReadonlyMap<string, ResourceType>,
): MapLayout {
  const ids = new Set(nodeIds);
  const visible = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  // Connected groups (every visible edge counts, informational ones too).
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const e of visible) parent.set(find(e.from), find(e.to));
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  const components = [...groups.values()].filter((g) => g.length > 1);
  const loners = [...groups.values()].filter((g) => g.length === 1).map((g) => g[0]!);
  components.sort((a, b) => b.length - a.length);

  const edgesByNode = new Map<string, GraphEdge[]>();
  for (const e of visible)
    for (const id of [e.from, e.to]) edgesByNode.set(id, [...(edgesByNode.get(id) ?? []), e]);

  const laid = components.map((c) => {
    const set = new Set(c);
    const own = [...new Set(c.flatMap((id) => edgesByNode.get(id) ?? []))].filter(
      (e) => set.has(e.from) && set.has(e.to),
    );
    return layoutComponent(c, own, types);
  });

  // One vertical scale for every group: a layer is as tall as its tallest
  // occurrence, so the same layer is on the same row across groups.
  const rowsPerLayer = new Map<number, number>();
  for (const c of laid)
    for (const [layer, rows] of c.rowsPerLayer)
      rowsPerLayer.set(layer, Math.max(rowsPerLayer.get(layer) ?? 0, rows));
  const layerY = new Map<number, number>();
  let y = 0;
  for (const layer of [...rowsPerLayer.keys()].sort((a, b) => a - b)) {
    layerY.set(layer, y);
    const rows = rowsPerLayer.get(layer)!;
    y += rows * NODE_HEIGHT + (rows - 1) * ROW_GAP + GAP_Y;
  }
  const blocks: Block[] = laid.map((c) => {
    const positions = new Map<string, Point>();
    for (const [id, { x, layer, row }] of c.nodes)
      positions.set(id, { x, y: layerY.get(layer)! + row * (NODE_HEIGHT + ROW_GAP) });
    return normalise(positions, false);
  });
  if (loners.length) blocks.push(trayBlock(loners, types));

  return {
    positions: pack(blocks),
    primary: components[0] ?? loners,
  };
}

interface Block {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

interface LaidComponent {
  nodes: Map<string, { x: number; layer: number; row: number }>;
  rowsPerLayer: Map<number, number>;
}

function layoutComponent(
  nodeIds: string[],
  edges: GraphEdge[],
  types?: ReadonlyMap<string, ResourceType>,
): LaidComponent {
  const floor = (id: string) => (types ? TYPE_LAYER[types.get(id) ?? "OTHER"] : 0);

  // Layer constraints, cycles broken by an iterative DFS.
  const below = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    const l = layering(e);
    if (l && l[0] !== l[1]) below.get(l[0])!.push(l[1]);
  }
  const state = new Map<string, 1 | 2>();
  const dag = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const root of nodeIds) {
    if (state.has(root)) continue;
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const children = below.get(top[0])!;
      if (top[1] < children.length) {
        const child = children[top[1]++]!;
        const s = state.get(child);
        if (s === 1) continue; // back edge: dropped for layering
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

  // Layer = the lowest of its type's layer and one below everything above it.
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const t of dag.values()) for (const v of t) indegree.set(v, indegree.get(v)! + 1);
  const layer = new Map<string, number>(nodeIds.map((id) => [id, floor(id)]));
  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i]!;
    for (const v of dag.get(u)!) {
      layer.set(v, Math.max(layer.get(v)!, layer.get(u)! + 1));
      indegree.set(v, indegree.get(v)! - 1);
      if (indegree.get(v) === 0) queue.push(v);
    }
  }

  // Pull nodes without anything below them down next to what they serve?
  // No: a node with nothing above sits on its type's layer (stable reading).
  // Compress empty layers.
  const used = [...new Set(layer.values())].sort((a, b) => a - b);
  const index = new Map(used.map((l, i) => [l, i]));
  const layers: string[][] = used.map(() => []);

  // Initial order: breadth-first from the top, so neighbours start close.
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    adjacency.get(e.from)!.push(e.to);
    adjacency.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>();
  const starts = [...nodeIds].sort(
    (a, b) => layer.get(a)! - layer.get(b)! || adjacency.get(b)!.length - adjacency.get(a)!.length,
  );
  for (const s of starts) {
    if (seen.has(s)) continue;
    const q = [s];
    seen.add(s);
    for (let i = 0; i < q.length; i++) {
      const u = q[i]!;
      layers[index.get(layer.get(u)!)!]!.push(u);
      for (const v of adjacency.get(u)!)
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
    }
  }

  // Crossing reduction: barycentre sweeps over all neighbours.
  const order = new Map<string, number>();
  const reindex = (l: string[]) => l.forEach((id, i) => order.set(id, (i + 0.5) / l.length));
  layers.forEach(reindex);
  for (let pass = 0; pass < 8; pass++) {
    const sequence = pass % 2 === 0 ? layers : [...layers].reverse();
    for (const l of sequence) {
      const score = new Map(
        l.map((id) => {
          const ns = adjacency.get(id)!;
          return [
            id,
            ns.length ? ns.reduce((a, n) => a + order.get(n)!, 0) / ns.length : order.get(id)!,
          ];
        }),
      );
      l.sort((a, b) => score.get(a)! - score.get(b)! || order.get(a)! - order.get(b)!);
      reindex(l);
    }
  }

  // Rows: wide layers wrap into MAX_ROW-wide rows.
  const rows: { ids: string[]; layer: number; row: number }[] = [];
  layers.forEach((l, li) => {
    for (let s = 0; s < l.length; s += MAX_ROW)
      rows.push({ ids: l.slice(s, s + MAX_ROW), layer: used[li]!, row: s / MAX_ROW });
  });

  // Horizontal placement: each node as close as possible to the mean of its
  // neighbours, keeping the row order and spacing (isotonic regression).
  const x = new Map<string, number>();
  for (const r of rows) r.ids.forEach((id, i) => x.set(id, (i - (r.ids.length - 1) / 2) * SPACING));
  for (let pass = 0; pass < 10; pass++) {
    const sequence = pass % 2 === 0 ? rows : [...rows].reverse();
    for (const r of sequence) {
      const desired = r.ids.map((id) => {
        const ns = adjacency.get(id)!;
        return ns.length ? ns.reduce((a, n) => a + x.get(n)!, 0) / ns.length : x.get(id)!;
      });
      placeRow(desired).forEach((v, i) => x.set(r.ids[i]!, v));
    }
  }

  const nodes = new Map<string, { x: number; layer: number; row: number }>();
  const rowsPerLayer = new Map<number, number>();
  for (const r of rows) {
    rowsPerLayer.set(r.layer, Math.max(rowsPerLayer.get(r.layer) ?? 0, r.row + 1));
    for (const id of r.ids) nodes.set(id, { x: x.get(id)!, layer: r.layer, row: r.row });
  }
  return { nodes, rowsPerLayer };
}

/**
 * Closest positions to `desired` with increasing order and SPACING between
 * neighbours: pool-adjacent-violators on y_i = x_i − i·SPACING.
 */
export function placeRow(desired: readonly number[]): number[] {
  const blocks: { sum: number; count: number }[] = [];
  desired.forEach((d, i) => {
    blocks.push({ sum: d - i * SPACING, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  });
  const out: number[] = [];
  for (const b of blocks)
    for (let k = 0; k < b.count; k++) out.push(b.sum / b.count + out.length * SPACING);
  return out;
}

/** Resources without relationships: a compact grid, by type then name. */
function trayBlock(ids: string[], types?: ReadonlyMap<string, ResourceType>): Block {
  const sorted = [...ids].sort(
    (a, b) =>
      (types ? TYPE_LAYER[types.get(a) ?? "OTHER"] - TYPE_LAYER[types.get(b) ?? "OTHER"] : 0) ||
      a.localeCompare(b),
  );
  const columns = Math.min(TRAY_COLUMNS, sorted.length);
  const positions = new Map<string, Point>();
  sorted.forEach((id, i) =>
    positions.set(id, {
      x: (i % columns) * SPACING,
      y: Math.floor(i / columns) * (NODE_HEIGHT + ROW_GAP),
    }),
  );
  return normalise(positions);
}

/** Shift to the origin; `vertically: false` keeps the shared layer rows. */
function normalise(positions: Map<string, Point>, vertically = true): Block {
  const pts = [...positions.values()];
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = vertically ? Math.min(...pts.map((p) => p.y)) : 0;
  const out = new Map<string, Point>();
  for (const [id, p] of positions) out.set(id, { x: p.x - minX, y: p.y - minY });
  return {
    positions: out,
    width: Math.max(...pts.map((p) => p.x)) - minX + NODE_WIDTH,
    height: Math.max(...pts.map((p) => p.y)) - minY + NODE_HEIGHT,
  };
}

/**
 * Packs the groups: when one group dominates (most maps: everything hangs
 * from the same domain / hosts), the others go in columns to its right;
 * otherwise (many similar groups) shelves aiming at a screen-like shape.
 * The tray of unconnected resources goes last.
 */
function pack(blocks: Block[]): Map<string, Point> {
  const out = new Map<string, Point>();
  if (!blocks.length) return out;
  const place = (b: Block, x: number, y: number) => {
    for (const [id, p] of b.positions) out.set(id, { x: p.x + x + 16, y: p.y + y + 16 });
  };
  const area = (b: Block) => (b.width + COMPONENT_GAP) * (b.height + COMPONENT_GAP);
  const total = blocks.reduce((a, b) => a + area(b), 0);
  const [main, ...rest] = blocks;

  if (area(main!) >= total / 2) {
    place(main!, 0, 0);
    const columnHeight = Math.max(main!.height, NODE_HEIGHT * 8);
    let x = main!.width + COMPONENT_GAP;
    let y = 0;
    let columnWidth = 0;
    for (const b of rest) {
      if (y > 0 && y + b.height > columnHeight) {
        x += columnWidth + COMPONENT_GAP;
        y = 0;
        columnWidth = 0;
      }
      place(b, x, y);
      y += b.height + COMPONENT_GAP;
      columnWidth = Math.max(columnWidth, b.width);
    }
    return out;
  }

  const target = Math.max(Math.max(...blocks.map((b) => b.width)), Math.sqrt(total * 1.7));
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.width > target) {
      x = 0;
      y += shelf + COMPONENT_GAP;
      shelf = 0;
    }
    place(b, x, y);
    x += b.width + COMPONENT_GAP;
    shelf = Math.max(shelf, b.height);
  }
  return out;
}
