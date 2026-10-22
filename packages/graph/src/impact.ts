// SPDX-License-Identifier: AGPL-3.0-only
import { dependencyDirection, type GraphEdge } from "./graph";
import { CONFIDENCE_RANK, type Confidence } from "./relationship-types";

/** Edge with its confidence; null = IGNORED (never used). */
export interface ImpactEdge extends GraphEdge {
  confidence: Confidence | null;
}

export interface ImpactOptions {
  /** Maximum hops from the failing resource. Default 10. */
  maxDepth?: number;
  /** Confidences to consider. Default all three. */
  include?: readonly Confidence[];
}

export interface AffectedResource {
  resourceId: string;
  /** Hops from the failing resource along the reported path. */
  depth: number;
  /** Weakest confidence along the path — the strongest achievable for this resource. */
  confidence: Confidence;
  /** Resource ids from the failing resource (first) to this one (last). */
  path: string[];
  /** Relationship ids along `path`. */
  viaEdges: string[];
}

export interface ImpactResult {
  rootId: string;
  /** Sorted by confidence (strongest first), then depth, then id. */
  affected: AffectedResource[];
}

const LEVELS: Confidence[] = ["confirmed", "detected", "inferred"];

/**
 * Potential blast radius of `rootId` failing (docs/ARCHITECTURE.md §6.3).
 *
 * Failure flows from a dependency to its dependents (`dependencyDirection`);
 * non-propagating types and ignored edges are skipped. Layered BFS: pass 1 uses
 * only confirmed edges, pass 2 adds detected, pass 3 adds inferred. A resource
 * first reached in pass k gets confidence k — so every resource carries the
 * STRONGEST confidence any path offers, and the fewest hops among such paths.
 * Cycle-safe; O(3 · (V + E)).
 */
export function impact(
  edges: readonly ImpactEdge[],
  rootId: string,
  options: ImpactOptions = {},
): ImpactResult {
  const maxDepth = options.maxDepth ?? 10;
  const include = new Set(options.include ?? LEVELS);
  const levels = LEVELS.filter((l) => include.has(l));

  // dependency -> [dependent, edge]
  const adjacency = new Map<string, { to: string; edgeId: string; confidence: Confidence }[]>();
  for (const edge of edges) {
    if (!edge.confidence || !include.has(edge.confidence)) continue;
    const dir = dependencyDirection(edge);
    if (!dir) continue;
    const list = adjacency.get(dir.dependency) ?? [];
    list.push({ to: dir.dependent, edgeId: edge.id, confidence: edge.confidence });
    adjacency.set(dir.dependency, list);
  }

  const assigned = new Map<string, AffectedResource>();

  levels.forEach((level, index) => {
    const allowed = new Set(levels.slice(0, index + 1));
    const parent = new Map<string, { from: string; edgeId: string } | null>([[rootId, null]]);
    const depthOf = new Map<string, number>([[rootId, 0]]);
    const queue = [rootId];

    for (let head = 0; head < queue.length; head++) {
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

    for (const id of queue) {
      if (id === rootId || assigned.has(id)) continue;
      const path = [id];
      const viaEdges: string[] = [];
      for (let step = parent.get(id); step; step = parent.get(step.from)) {
        path.unshift(step.from);
        viaEdges.unshift(step.edgeId);
      }
      assigned.set(id, {
        resourceId: id,
        depth: depthOf.get(id)!,
        confidence: level,
        path,
        viaEdges,
      });
    }
  });

  const affected = [...assigned.values()].sort(
    (a, b) =>
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      a.depth - b.depth ||
      a.resourceId.localeCompare(b.resourceId),
  );
  return { rootId, affected };
}

/** One resource affected by a change of several resources at once (M34). */
export interface ChangeAffected extends AffectedResource {
  /** Changed resources whose failure reaches this one, in the order given. */
  causes: string[];
}

export interface ChangeImpactResult {
  /** The changed resources, deduplicated, in the order given. */
  rootIds: string[];
  /** Same order as `impact`; the changed resources themselves are not listed. */
  affected: ChangeAffected[];
}

/** At most this many resources in one change (keeps the computation small). */
export const CHANGE_LIMIT = 50;

/**
 * Combined blast radius of several resources changing together ("reboot
 * SQL01 and APP02 on Saturday"). Each resource keeps the strongest evidence
 * and, among equally strong paths, the fewest hops from any changed resource;
 * `causes` lists every changed resource that reaches it. O(k · (V + E)).
 */
export function changeImpact(
  edges: readonly ImpactEdge[],
  rootIds: readonly string[],
  options: ImpactOptions = {},
): ChangeImpactResult {
  const roots = [...new Set(rootIds)].slice(0, CHANGE_LIMIT);
  const inChange = new Set(roots);
  const best = new Map<string, ChangeAffected>();
  for (const root of roots) {
    for (const a of impact(edges, root, options).affected) {
      if (inChange.has(a.resourceId)) continue;
      const current = best.get(a.resourceId);
      if (!current) {
        best.set(a.resourceId, { ...a, causes: [root] });
        continue;
      }
      current.causes.push(root);
      const stronger =
        CONFIDENCE_RANK[a.confidence] > CONFIDENCE_RANK[current.confidence] ||
        (a.confidence === current.confidence && a.depth < current.depth);
      if (stronger) best.set(a.resourceId, { ...a, causes: current.causes });
    }
  }
  const affected = [...best.values()].sort(
    (a, b) =>
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      a.depth - b.depth ||
      a.resourceId.localeCompare(b.resourceId),
  );
  return { rootIds: roots, affected };
}

export interface ImpactSummary {
  total: number;
  byConfidence: Record<Confidence, number>;
  /** Count per resource type (as given by `typeOf`). */
  byType: Record<string, number>;
}

export function summarizeImpact(
  result: { affected: readonly AffectedResource[] },
  typeOf: (id: string) => string,
): ImpactSummary {
  const byConfidence: Record<Confidence, number> = { confirmed: 0, detected: 0, inferred: 0 };
  const byType: Record<string, number> = {};
  for (const a of result.affected) {
    byConfidence[a.confidence]++;
    const type = typeOf(a.resourceId);
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return { total: result.affected.length, byConfidence, byType };
}
