// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Layout quality metrics (M26): numbers to compare map layouts instead of
 * judging screenshots alone. Pure; used by tests and the load test.
 */
import { dependencyDirection, type GraphEdge } from "@depmap/graph";
import { NODE_HEIGHT, NODE_WIDTH, drawDirection, type Point } from "./layout";

export interface LayoutMetrics {
  width: number;
  height: number;
  /** width / height of the bounding box (a screen is ~1.6–1.8). */
  aspect: number;
  /** Edges drawn as straight lines between node centres that cross another. */
  crossings: number;
  /** Dependency edges whose dependency is not below the dependent (informational edges excluded). */
  upward: number;
  /** Pairs of nodes whose boxes overlap. */
  overlaps: number;
  /** Mean edge length in node heights (shorter = related things are close). */
  meanEdgeLength: number;
}

type Segment = [number, number, number, number];

function intersects([ax, ay, bx, by]: Segment, [cx, cy, dx, dy]: Segment): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return (
    o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 &&
    o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0
  );
}

export function layoutMetrics(
  positions: ReadonlyMap<string, Point>,
  edges: readonly GraphEdge[],
  /** Edge types allowed to point up (reading order: entry points above what they expose). */
  upwardAllowed: ReadonlySet<string> = new Set(),
): LayoutMetrics {
  const pts = [...positions.values()];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x)) + NODE_WIDTH;
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y)) + NODE_HEIGHT;
  const centre = (id: string) => {
    const p = positions.get(id)!;
    return [p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2] as const;
  };
  const visible = edges.filter((e) => positions.has(e.from) && positions.has(e.to));
  const segments: Segment[] = visible.map((e) => {
    const [ax, ay] = centre(e.from);
    const [bx, by] = centre(e.to);
    return [ax, ay, bx, by];
  });
  let crossings = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = visible[i]!;
      const b = visible[j]!;
      const shared = new Set([a.from, a.to]).has(b.from) || new Set([a.from, a.to]).has(b.to);
      if (!shared && intersects(segments[i]!, segments[j]!)) crossings++;
    }
  let upward = 0;
  let length = 0;
  for (const e of visible) {
    const { source, target } = drawDirection(e);
    if (
      dependencyDirection(e) !== null &&
      !upwardAllowed.has(e.type) &&
      positions.get(source)!.y >= positions.get(target)!.y
    )
      upward++;
    const [ax, ay] = centre(e.from);
    const [bx, by] = centre(e.to);
    length += Math.hypot(ax - bx, ay - by);
  }
  let overlaps = 0;
  const ids = [...positions.keys()];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions.get(ids[i]!)!;
      const b = positions.get(ids[j]!)!;
      if (Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT) overlaps++;
    }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    width,
    height,
    aspect: Math.round((width / height) * 100) / 100,
    crossings,
    upward,
    overlaps,
    meanEdgeLength: visible.length
      ? Math.round((length / visible.length / NODE_HEIGHT) * 10) / 10
      : 0,
  };
}
