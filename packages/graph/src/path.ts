// SPDX-License-Identifier: AGPL-3.0-only
import { dependencyDirection, perspective } from "./graph";
import type { ImpactEdge } from "./impact";
import type { Confidence } from "./relationship-types";

/**
 * How the first resource relates to the second:
 * - `dependsOn`: it depends on the second, directly or through others;
 * - `usedBy`: the second depends on it;
 * - `connected`: they are linked, but neither depends on the other (for
 *   example both use the same database, or the link is "backs up to").
 */
export type PathKind = "dependsOn" | "usedBy" | "connected";

export interface ResourcePath {
  kind: PathKind;
  /** Weakest confidence along the path — the strongest any such path offers. */
  confidence: Confidence;
  /** Resource ids, the first resource first and the second last. */
  path: string[];
  /** Relationship ids along `path` (one fewer than `path`). */
  viaEdges: string[];
}

export interface PathOptions {
  /** Maximum hops. Default 20. */
  maxDepth?: number;
}

const LEVELS: Confidence[] = ["confirmed", "detected", "inferred"];

type Adjacency = Map<string, { to: string; edgeId: string; confidence: Confidence }[]>;

function push(map: Adjacency, from: string, to: string, edge: ImpactEdge) {
  const list = map.get(from) ?? [];
  list.push({ to, edgeId: edge.id, confidence: edge.confidence! });
  map.set(from, list);
}

/**
 * Shortest path from `start` to `target` using the strongest confidence that
 * reaches it: confirmed edges only, then also detected, then also inferred
 * (the same layering as impact). Cycle-safe BFS.
 */
function layered(
  adjacency: Adjacency,
  start: string,
  target: string,
  maxDepth: number,
): Omit<ResourcePath, "kind"> | null {
  for (const [index, level] of LEVELS.entries()) {
    const allowed = new Set(LEVELS.slice(0, index + 1));
    const parent = new Map<string, { from: string; edgeId: string } | null>([[start, null]]);
    const depthOf = new Map<string, number>([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length && !parent.has(target); head++) {
      const current = queue[head]!;
      const depth = depthOf.get(current)!;
      if (depth >= maxDepth) continue;
      for (const next of adjacency.get(current) ?? []) {
        if (!allowed.has(next.confidence) || parent.has(next.to)) continue;
        parent.set(next.to, { from: current, edgeId: next.edgeId });
        depthOf.set(next.to, depth + 1);
        queue.push(next.to);
      }
    }
    if (!parent.has(target)) continue;
    const path = [target];
    const viaEdges: string[] = [];
    for (let step = parent.get(target); step; step = parent.get(step.from)) {
      path.unshift(step.from);
      viaEdges.unshift(step.edgeId);
    }
    return { confidence: level, path, viaEdges };
  }
  return null;
}

/**
 * How two resources are linked (M30): a dependency chain from `fromId` to
 * `toId`, else one from `toId` to `fromId`, else any chain of relationships
 * between them (`connected`, including non-propagating types). Ignored edges
 * (confidence null) are never used. Null when they are not linked within
 * `maxDepth` hops, or when both ids are the same.
 */
export function findPath(
  edges: readonly ImpactEdge[],
  fromId: string,
  toId: string,
  options: PathOptions = {},
): ResourcePath | null {
  if (fromId === toId) return null;
  const maxDepth = options.maxDepth ?? 20;
  const down: Adjacency = new Map(); // dependent -> dependency
  const up: Adjacency = new Map(); // dependency -> dependent
  const any: Adjacency = new Map(); // both ways, every type
  for (const edge of edges) {
    if (!edge.confidence) continue;
    const dir = dependencyDirection(edge);
    if (dir) {
      push(down, dir.dependent, dir.dependency, edge);
      push(up, dir.dependency, dir.dependent, edge);
    }
    push(any, edge.from, edge.to, edge);
    push(any, edge.to, edge.from, edge);
  }
  const dependsOn = layered(down, fromId, toId, maxDepth);
  if (dependsOn) return { kind: "dependsOn", ...dependsOn };
  const usedBy = layered(up, fromId, toId, maxDepth);
  if (usedBy) return { kind: "usedBy", ...usedBy };
  const connected = layered(any, fromId, toId, maxDepth);
  return connected && { kind: "connected", ...connected };
}

export interface PathStep {
  from: string;
  to: string;
  edgeId: string;
  /** Read from `from`'s side: "<from> <phrase> <to>". */
  phrase: string;
  confidence: Confidence;
}

/** The steps of a path, each phrased from the resource it starts at. */
export function pathSteps(result: ResourcePath, edges: readonly ImpactEdge[]): PathStep[] {
  const byId = new Map(edges.map((e) => [e.id, e]));
  return result.viaEdges.map((edgeId, i) => {
    const edge = byId.get(edgeId)!;
    const from = result.path[i]!;
    return {
      from,
      to: result.path[i + 1]!,
      edgeId,
      phrase: perspective(edge, from).phrase,
      confidence: edge.confidence!,
    };
  });
}

/**
 * Plain-text explanation of a path, to paste in a change request:
 * a headline, then one line per step ("Billing uses database CustomersDB").
 */
export function describePath(
  result: ResourcePath,
  edges: readonly ImpactEdge[],
  nameOf: (id: string) => string,
): string {
  const from = nameOf(result.path[0]!);
  const to = nameOf(result.path.at(-1)!);
  // Never present an unconfirmed chain as a dependency (docs/PRODUCT.md).
  const sure = result.confidence === "confirmed";
  const depends = sure ? "depends on" : "may depend on";
  const note = sure ? "" : ` (${result.confidence}, not confirmed)`;
  const headline =
    result.kind === "dependsOn"
      ? `${from} ${depends} ${to}${note}:`
      : result.kind === "usedBy"
        ? `${to} ${depends} ${from}${note}:`
        : `${from} and ${to} are connected, but neither depends on the other${note}:`;
  const lines = pathSteps(result, edges).map(
    (s) =>
      `- ${nameOf(s.from)} ${s.phrase} ${nameOf(s.to)}` +
      (s.confidence === "confirmed" ? "" : ` (${s.confidence}, not confirmed)`),
  );
  return [headline, ...lines].join("\n");
}
