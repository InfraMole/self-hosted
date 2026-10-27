// SPDX-License-Identifier: AGPL-3.0-only
import { dependencyDirection } from "./graph";
import type { ImpactEdge } from "./impact";
import type { Confidence } from "./relationship-types";

export interface RecoveryOptions {
  /** Confidences to consider. Default all three. */
  include?: readonly Confidence[];
  /** Redundancy groups (M39): resource id → group key; members share a step. */
  groups?: ReadonlyMap<string, string>;
}

/** Resources brought back together. */
export interface RecoveryStep {
  /** Sorted resource ids. */
  ids: string[];
  /** Members depend on each other in a circle: the order inside is unknown. */
  circular: boolean;
  /** Set when the step is one redundancy group (and not circular). */
  group?: string;
}

export interface RecoveryOrder {
  /**
   * Waves in restore order: wave 1 depends on nothing in scope, every later
   * step depends only on earlier waves (and the steps of a wave are
   * independent of each other).
   */
  waves: RecoveryStep[][];
  /** Resources with no relationship that propagates failure, either way. */
  unconnected: string[];
}

/**
 * In what order to bring `nodeIds` back after they all went down (M44,
 * ADR-060). Uses only edges between them that propagate failure, in
 * dependency direction (`dependencyDirection`, ADR-015) and with an included
 * confidence. Members of a redundancy group form one step; resources that
 * depend on each other in a circle form one step flagged `circular`. Each
 * step lands in the earliest wave after everything it depends on.
 * O(V + E); iterative (no recursion limits).
 */
export function recoveryOrder(
  nodeIds: readonly string[],
  edges: readonly ImpactEdge[],
  options: RecoveryOptions = {},
): RecoveryOrder {
  const ids = [...new Set(nodeIds)].sort();
  const inScope = new Set(ids);
  const include = new Set<Confidence>(options.include ?? ["confirmed", "detected", "inferred"]);

  // Units: a redundancy group with at least two members in scope, else the resource.
  const groupCount = new Map<string, number>();
  for (const id of ids) {
    const g = options.groups?.get(id);
    if (g !== undefined) groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
  }
  const unitOf = (id: string) => {
    const g = options.groups?.get(id);
    return g !== undefined && groupCount.get(g)! > 1 ? `group:${g}` : `id:${id}`;
  };
  const unitIds = new Map<string, string[]>();
  for (const id of ids) unitIds.set(unitOf(id), [...(unitIds.get(unitOf(id)) ?? []), id]);

  // needs: unit → units it depends on (must come back first).
  const needs = new Map<string, Set<string>>();
  const linked = new Set<string>();
  for (const edge of edges) {
    if (!edge.confidence || !include.has(edge.confidence)) continue;
    if (!inScope.has(edge.from) || !inScope.has(edge.to)) continue;
    const dir = dependencyDirection(edge);
    if (!dir) continue;
    const a = unitOf(dir.dependent);
    const b = unitOf(dir.dependency);
    linked.add(dir.dependent).add(dir.dependency);
    if (a === b) continue;
    needs.set(a, (needs.get(a) ?? new Set()).add(b));
  }

  const units = [...unitIds.keys()].filter((u) => unitIds.get(u)!.some((id) => linked.has(id)));
  const components = stronglyConnected(units, needs);

  // Tarjan emits a component after every component it can reach (its
  // dependencies), so one pass assigns waves.
  const componentOf = new Map<string, number>();
  components.forEach((c, i) => c.forEach((u) => componentOf.set(u, i)));
  const wave: number[] = [];
  components.forEach((c, i) => {
    let w = 0;
    for (const u of c)
      for (const dep of needs.get(u) ?? []) {
        const j = componentOf.get(dep)!;
        if (j !== i) w = Math.max(w, wave[j]! + 1);
      }
    wave[i] = w;
  });

  const waves: RecoveryStep[][] = [];
  components.forEach((c, i) => {
    const step: RecoveryStep = {
      ids: c.flatMap((u) => unitIds.get(u)!).sort(),
      circular: c.length > 1,
    };
    if (c.length === 1 && c[0]!.startsWith("group:")) step.group = c[0]!.slice("group:".length);
    (waves[wave[i]!] ??= []).push(step);
  });
  for (const w of waves) w.sort((a, b) => a.ids[0]!.localeCompare(b.ids[0]!));
  return { waves, unconnected: ids.filter((id) => !linked.has(id)) };
}

/** Tarjan's strongly connected components, iterative; reverse topological order. */
function stronglyConnected(nodes: readonly string[], next: ReadonlyMap<string, Set<string>>) {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { node: string; it: Iterator<string> }[] = [];
    const open = (node: string) => {
      index.set(node, counter);
      low.set(node, counter++);
      stack.push(node);
      onStack.add(node);
      work.push({ node, it: (next.get(node) ?? new Set<string>()).values() });
    };
    open(start);
    while (work.length) {
      const top = work.at(-1)!;
      const step = top.it.next();
      if (!step.done) {
        const to = step.value;
        if (!index.has(to)) open(to);
        else if (onStack.has(to)) low.set(top.node, Math.min(low.get(top.node)!, index.get(to)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work.at(-1)!.node;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.node)!));
      }
      if (low.get(top.node) === index.get(top.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== top.node);
        out.push(component);
      }
    }
  }
  return out;
}
