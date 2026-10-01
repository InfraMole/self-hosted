// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map layout (pure, unit tested; M26, ADR-039). A layered "stack" read top
 * to bottom: entry points (CDN, domains, load balancers) → applications →
 * services → data → compute → hosts. Each resource sits on the layer of its
 * type or lower, never above what depends on it, so arrows point down
 * ("what does this need?") — except "exposed through", drawn from below up
 * to the proxy that fronts it (the path a request takes).
 *
 * Connected groups are laid out separately and packed; resources without
 * relationships go to a tray. Nodes may have their own size (expanded
 * groups, phase 2). Linear-ish in nodes + edges: 2,000 servers lay out in
 * well under a second.
 */
import { dependencyDirection, type GraphEdge } from "@depmap/graph";
import type { ResourceType } from "@/generated/prisma/enums";

export const NODE_WIDTH = 212;
export const NODE_HEIGHT = 40;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
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
const NODE: Size = { width: NODE_WIDTH, height: NODE_HEIGHT };

export interface MapLayout {
  /** Top-left of each node. */
  positions: Map<string, Point>;
  /** Node ids of the largest connected group: where a large map opens. */
  primary: string[];
  /** Bounding box of the whole layout (from 0,0). */
  size: Size;
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

export interface Spacing {
  gapX: number;
  gapY: number;
  rowGap: number;
  componentGap: number;
}

export const MAP_SPACING: Spacing = {
  gapX: GAP_X,
  gapY: GAP_Y,
  rowGap: ROW_GAP,
  componentGap: COMPONENT_GAP,
};
/** Inside a group box: tighter, so boxes stay small. */
export const BOX_SPACING: Spacing = { gapX: 20, gapY: 36, rowGap: 14, componentGap: 28 };

export function stackLayout(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  types?: ReadonlyMap<string, ResourceType>,
  sizes?: ReadonlyMap<string, Size>,
  spacing: Spacing = MAP_SPACING,
): MapLayout {
  const sizeOf = (id: string) => sizes?.get(id) ?? NODE;
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
    return layoutComponent(c, own, sizeOf, types, spacing);
  });

  // One vertical scale for every group: a row of a layer is as tall as its
  // tallest occurrence, so the same layer is on the same row across groups.
  const rowHeights = new Map<number, number[]>();
  for (const c of laid)
    for (const [layer, heights] of c.rowHeights) {
      const cur = rowHeights.get(layer) ?? [];
      heights.forEach((h, i) => (cur[i] = Math.max(cur[i] ?? 0, h)));
      rowHeights.set(layer, cur);
    }
  const rowY = new Map<string, number>(); // "layer|row" → y
  let y = 0;
  for (const layer of [...rowHeights.keys()].sort((a, b) => a - b)) {
    const heights = rowHeights.get(layer)!;
    heights.forEach((h, i) => {
      rowY.set(`${layer}|${i}`, y);
      y += h + (i < heights.length - 1 ? spacing.rowGap : spacing.gapY);
    });
  }
  const blocks: Block[] = laid.map((c) => {
    const positions = new Map<string, Point>();
    for (const [id, { cx, layer, row }] of c.nodes)
      positions.set(id, { x: cx - sizeOf(id).width / 2, y: rowY.get(`${layer}|${row}`)! });
    return normalise(positions, sizeOf, false);
  });
  if (loners.length) blocks.push(trayBlock(loners, sizeOf, types, spacing));

  const positions = pack(blocks, spacing);
  let width = 0;
  let height = 0;
  for (const [id, p] of positions) {
    width = Math.max(width, p.x + sizeOf(id).width);
    height = Math.max(height, p.y + sizeOf(id).height);
  }
  return { positions, primary: components[0] ?? loners, size: { width, height } };
}

interface Block {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

interface LaidComponent {
  /** Horizontal centre, layer and row within the layer. */
  nodes: Map<string, { cx: number; layer: number; row: number }>;
  /** Per layer, the height of each of its rows. */
  rowHeights: Map<number, number[]>;
}

function layoutComponent(
  nodeIds: string[],
  edges: GraphEdge[],
  sizeOf: (id: string) => Size,
  types: ReadonlyMap<string, ResourceType> | undefined,
  spacing: Spacing,
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

  // Horizontal placement: each node's centre as close as possible to the mean
  // of its neighbours' centres, keeping row order and spacing.
  const cx = new Map<string, number>();
  for (const r of rows) {
    const widths = r.ids.map((id) => sizeOf(id).width);
    const total = widths.reduce((a, w) => a + w, 0) + spacing.gapX * (widths.length - 1);
    let x = -total / 2;
    r.ids.forEach((id, i) => {
      cx.set(id, x + widths[i]! / 2);
      x += widths[i]! + spacing.gapX;
    });
  }
  for (let pass = 0; pass < 10; pass++) {
    const sequence = pass % 2 === 0 ? rows : [...rows].reverse();
    for (const r of sequence) {
      const desired = r.ids.map((id) => {
        const ns = adjacency.get(id)!;
        return ns.length ? ns.reduce((a, n) => a + cx.get(n)!, 0) / ns.length : cx.get(id)!;
      });
      placeRow(
        desired,
        r.ids.map((id) => sizeOf(id).width),
        spacing.gapX,
      ).forEach((v, i) => cx.set(r.ids[i]!, v));
    }
  }

  const nodes = new Map<string, { cx: number; layer: number; row: number }>();
  const rowHeights = new Map<number, number[]>();
  for (const r of rows) {
    const heights = rowHeights.get(r.layer) ?? [];
    heights[r.row] = Math.max(heights[r.row] ?? 0, ...r.ids.map((id) => sizeOf(id).height));
    rowHeights.set(r.layer, heights);
    for (const id of r.ids) nodes.set(id, { cx: cx.get(id)!, layer: r.layer, row: r.row });
  }
  return { nodes, rowHeights };
}

/**
 * Centres closest to `desired`, keeping the order and a gap between
 * neighbours of the given widths (default: plain nodes):
 * pool-adjacent-violators on y_i = c_i − offset_i.
 */
export function placeRow(
  desired: readonly number[],
  widths?: readonly number[],
  gap = GAP_X,
): number[] {
  const w = (i: number) => widths?.[i] ?? NODE_WIDTH;
  const offsets: number[] = [];
  desired.forEach((_, i) =>
    offsets.push(i === 0 ? 0 : offsets[i - 1]! + (w(i - 1) + w(i)) / 2 + gap),
  );
  const blocks: { sum: number; count: number }[] = [];
  desired.forEach((d, i) => {
    blocks.push({ sum: d - offsets[i]!, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  });
  const out: number[] = [];
  for (const b of blocks)
    for (let k = 0; k < b.count; k++) out.push(b.sum / b.count + offsets[out.length]!);
  return out;
}

/** Resources without relationships: a compact grid, by type then name. */
function trayBlock(
  ids: string[],
  sizeOf: (id: string) => Size,
  types: ReadonlyMap<string, ResourceType> | undefined,
  spacing: Spacing,
): Block {
  const sorted = [...ids].sort(
    (a, b) =>
      (types ? TYPE_LAYER[types.get(a) ?? "OTHER"] - TYPE_LAYER[types.get(b) ?? "OTHER"] : 0) ||
      a.localeCompare(b),
  );
  const columns = Math.min(TRAY_COLUMNS, sorted.length);
  // Rows of `columns` items, each as wide as itself (boxes are wider than nodes).
  const positions = new Map<string, Point>();
  let y = 0;
  for (let start = 0; start < sorted.length; start += columns) {
    const row = sorted.slice(start, start + columns);
    let x = 0;
    for (const id of row) {
      positions.set(id, { x, y });
      x += sizeOf(id).width + spacing.gapX;
    }
    y += Math.max(...row.map((id) => sizeOf(id).height)) + spacing.rowGap;
  }
  return normalise(positions, sizeOf);
}

/** Shift to the origin; `vertically: false` keeps the shared layer rows. */
function normalise(
  positions: Map<string, Point>,
  sizeOf: (id: string) => Size,
  vertically = true,
): Block {
  const entries = [...positions.entries()];
  const minX = Math.min(...entries.map(([, p]) => p.x));
  const minY = vertically ? Math.min(...entries.map(([, p]) => p.y)) : 0;
  const out = new Map<string, Point>();
  for (const [id, p] of entries) out.set(id, { x: p.x - minX, y: p.y - minY });
  return {
    positions: out,
    width: Math.max(...entries.map(([id, p]) => p.x + sizeOf(id).width)) - minX,
    height: Math.max(...entries.map(([id, p]) => p.y + sizeOf(id).height)) - minY,
  };
}

/**
 * Packs the groups: when one group dominates (most maps: everything hangs
 * from the same domain / hosts), the others go in columns to its right;
 * otherwise (many similar groups) shelves aiming at a screen-like shape.
 * The tray of unconnected resources goes last.
 */
function pack(blocks: Block[], spacing: Spacing): Map<string, Point> {
  const COMPONENT_GAP = spacing.componentGap;
  const out = new Map<string, Point>();
  if (!blocks.length) return out;
  const place = (b: Block, x: number, y: number) => {
    for (const [id, p] of b.positions) out.set(id, { x: p.x + x, y: p.y + y });
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
