// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Collapsible groups (M26 phase 2, ADR-040). Pure, unit tested.
 *
 * A resource that runs on exactly one visible resource (RUNS_ON), or is
 * hosted by exactly one (HOSTS), is drawn inside it: containers inside their
 * Docker host, VMs inside their hypervisor, sites and databases inside their
 * server — nested as deep as placement goes. Placement then needs no arrow.
 * A collapsed group is one node; edges of what it contains attach to it.
 */
import type { GraphEdge } from "@depmap/graph";
import type { ResourceType } from "@/generated/prisma/enums";
import { BOX_SPACING, NODE_HEIGHT, NODE_WIDTH, stackLayout, type Point, type Size } from "./layout";

/** Placement edges: [child, parent] when the edge puts one resource inside another. */
export function placement(edge: GraphEdge): [child: string, parent: string] | null {
  if (edge.type === "RUNS_ON") return [edge.from, edge.to];
  if (edge.type === "HOSTS") return [edge.to, edge.from];
  return null;
}

export interface Containment {
  parentOf: Map<string, string>;
  children: Map<string, string[]>;
}

/** Who is inside whom: only single, acyclic placements. */
export function containment(ids: readonly string[], edges: readonly GraphEdge[]): Containment {
  const visible = new Set(ids);
  const candidates = new Map<string, Set<string>>();
  for (const e of edges) {
    const p = placement(e);
    if (!p || !visible.has(p[0]) || !visible.has(p[1]) || p[0] === p[1]) continue;
    candidates.set(p[0], (candidates.get(p[0]) ?? new Set()).add(p[1]));
  }
  const parentOf = new Map<string, string>();
  const isAncestor = (maybe: string, of: string) => {
    for (let a = parentOf.get(of); a; a = parentOf.get(a)) if (a === maybe) return true;
    return false;
  };
  for (const id of ids) {
    const c = candidates.get(id);
    if (!c || c.size !== 1) continue; // runs on several (a Kubernetes workload): stays outside
    const parent = [...c][0]!;
    if (parent === id || isAncestor(id, parent)) continue; // would close a cycle
    parentOf.set(id, parent);
  }
  const children = new Map<string, string[]>();
  for (const id of ids) {
    const p = parentOf.get(id);
    if (p) children.set(p, [...(children.get(p) ?? []), id]);
  }
  return { parentOf, children };
}

export interface DisplayGraph<E extends GraphEdge = GraphEdge> {
  /** Every node drawn, outermost first (React Flow needs parents before children). */
  shown: string[];
  /** For a shown node inside an expanded group: that group. */
  parentOf: Map<string, string>;
  /** Expanded groups (drawn as boxes). */
  expanded: Set<string>;
  /** Collapsed groups → how many resources they hide. */
  hidden: Map<string, number>;
  /** Edges between shown nodes (hidden endpoints replaced by their collapsed group), deduplicated. */
  edges: E[];
}

export function displayGraph<E extends GraphEdge>(
  ids: readonly string[],
  edges: readonly E[],
  c: Containment,
  isExpanded: (groupId: string) => boolean,
): DisplayGraph<E> {
  const rep = new Map<string, string>();
  const shown: string[] = [];
  const parentOf = new Map<string, string>();
  const expanded = new Set<string>();
  const hidden = new Map<string, number>();
  const count = (id: string): number =>
    (c.children.get(id) ?? []).reduce((a, ch) => a + 1 + count(ch), 0);
  const hide = (id: string, as: string) => {
    rep.set(id, as);
    for (const ch of c.children.get(id) ?? []) hide(ch, as);
  };
  const visit = (id: string, parent: string | null) => {
    shown.push(id);
    rep.set(id, id);
    if (parent) parentOf.set(id, parent);
    const kids = c.children.get(id) ?? [];
    if (!kids.length) return;
    if (isExpanded(id)) {
      expanded.add(id);
      for (const ch of kids) visit(ch, id);
    } else {
      hidden.set(id, count(id));
      for (const ch of kids) hide(ch, id);
    }
  };
  for (const id of ids) if (!c.parentOf.has(id)) visit(id, null);

  const seen = new Set<string>();
  const out: E[] = [];
  for (const e of edges) {
    const from = rep.get(e.from);
    const to = rep.get(e.to);
    if (!from || !to || from === to) continue;
    // Placement inside an expanded box is shown by the box itself.
    const p = placement(e);
    if (p && parentOf.get(p[0]) === p[1]) continue;
    const key = `${from}|${to}|${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(from === e.from && to === e.to ? e : { ...e, from, to });
  }
  return { shown, parentOf, expanded, hidden, edges: out };
}

/** Box chrome around an expanded group's content. */
export const GROUP_HEADER = NODE_HEIGHT + 8;
export const GROUP_PADDING = 16;

export interface NestedLayout {
  /** Top-left, relative to the parent box (absolute for top-level nodes). */
  positions: Map<string, Point>;
  /** Absolute top-left of every shown node. */
  absolute: Map<string, Point>;
  /** Size of every shown node (boxes for expanded groups). */
  sizes: Map<string, Size>;
  /** Top-level ids of the main connected group. */
  primary: string[];
}

/**
 * Lays out each expanded group's content first (innermost out), then the
 * group as one larger node in the level above. Edges that cross a box are
 * lifted to the box at each level for layering.
 */
export function nestedLayout(
  g: DisplayGraph<GraphEdge>,
  types: ReadonlyMap<string, ResourceType>,
): NestedLayout {
  const sizes = new Map<string, Size>();
  const positions = new Map<string, Point>();
  const levelOf = (parent: string | null) =>
    g.shown.filter((id) => (g.parentOf.get(id) ?? null) === parent);
  // The ancestor of `id` that sits directly in `parent`'s level (or null).
  const atLevel = (id: string, parent: string | null): string | null => {
    let cur: string | undefined = id;
    while (cur !== undefined) {
      const p: string | null = g.parentOf.get(cur) ?? null;
      if (p === parent) return cur;
      cur = p ?? undefined;
    }
    return null;
  };
  const layoutLevel = (parent: string | null): { primary: string[]; size: Size } => {
    const level = levelOf(parent);
    for (const id of level) {
      if (!g.expanded.has(id)) {
        sizes.set(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
        continue;
      }
      const inner = layoutLevel(id);
      sizes.set(id, {
        width: Math.max(NODE_WIDTH, inner.size.width) + 2 * GROUP_PADDING,
        height: GROUP_HEADER + inner.size.height + GROUP_PADDING,
      });
    }
    const lifted: GraphEdge[] = [];
    const seen = new Set<string>();
    for (const e of g.edges) {
      const from = atLevel(e.from, parent);
      const to = atLevel(e.to, parent);
      if (!from || !to || from === to) continue;
      const key = `${from}|${to}|${e.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lifted.push({ ...e, from, to });
    }
    // Inside a box: compact — order only by the dependencies between its
    // contents (no type layers), tighter spacing.
    const laid = parent
      ? stackLayout(level, lifted, undefined, sizes, BOX_SPACING)
      : stackLayout(level, lifted, types, sizes);
    const offset = parent ? { x: GROUP_PADDING, y: GROUP_HEADER } : { x: 16, y: 16 };
    for (const [id, p] of laid.positions)
      positions.set(id, { x: p.x + offset.x, y: p.y + offset.y });
    return { primary: laid.primary, size: laid.size };
  };
  const top = layoutLevel(null);

  const absolute = new Map<string, Point>();
  for (const id of g.shown) {
    const p = positions.get(id)!;
    const parent = g.parentOf.get(id);
    const base = parent ? absolute.get(parent)! : { x: 0, y: 0 };
    absolute.set(id, { x: base.x + p.x, y: base.y + p.y });
  }
  return { positions, absolute, sizes, primary: top.primary };
}
