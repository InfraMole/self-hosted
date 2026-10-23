// SPDX-License-Identifier: AGPL-3.0-only
import { dependencyDirection, type GraphEdge } from "./graph";
import { CONFIDENCE_RANK, RELATIONSHIP_TYPE_INFO, type Confidence } from "./relationship-types";

/** Edge with its confidence; null = IGNORED (never used). */
export interface ImpactEdge extends GraphEdge {
  confidence: Confidence | null;
}

export interface ImpactOptions {
  /** Maximum hops from the failing resource. Default 10. */
  maxDepth?: number;
  /** Confidences to consider. Default all three. */
  include?: readonly Confidence[];
  /**
   * Redundancy groups (M39): resource id → group key. Members of a group are
   * interchangeable, so a failure only flows on from a member once EVERY
   * member of its group is down. Groups of one resource change nothing.
   */
  groups?: ReadonlyMap<string, string>;
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

/** Would be affected without redundancy, but another member still serves it (M39). */
export interface CoveredResource extends AffectedResource {
  /** The redundancy group whose remaining members cover it (first on the path). */
  group: string;
}

/** A redundancy group with some members down and some still up (M39). */
export interface DegradedGroup {
  group: string;
  /** Members down: failing or affected. */
  down: string[];
  /** Members still up. */
  up: string[];
}

export interface ImpactResult {
  rootId: string;
  /** Sorted by confidence (strongest first), then depth, then id. */
  affected: AffectedResource[];
  /** Same order; empty without redundancy groups. */
  covered: CoveredResource[];
  /** Groups that lose redundancy, by group key. */
  degraded: DegradedGroup[];
}

const LEVELS: Confidence[] = ["confirmed", "detected", "inferred"];

type Adjacency = Map<
  string,
  { to: string; edgeId: string; confidence: Confidence; placement: boolean }[]
>;

/** dependency -> [dependent, edge], only for included confidences and propagating types. */
function buildAdjacency(edges: readonly ImpactEdge[], include: ReadonlySet<Confidence>): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const edge of edges) {
    if (!edge.confidence || !include.has(edge.confidence)) continue;
    const dir = dependencyDirection(edge);
    if (!dir) continue;
    const list = adjacency.get(dir.dependency) ?? [];
    list.push({
      to: dir.dependent,
      edgeId: edge.id,
      confidence: edge.confidence,
      placement: RELATIONSHIP_TYPE_INFO[edge.type].placement === true,
    });
    adjacency.set(dir.dependency, list);
  }
  return adjacency;
}

/** Group key → members, only for groups with at least two members. */
function groupMembers(groups: ReadonlyMap<string, string> | undefined): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const [id, group] of groups ?? []) members.set(group, [...(members.get(group) ?? []), id]);
  for (const [group, list] of members) if (list.length < 2) members.delete(group);
  return members;
}

interface Spread {
  parent: Map<string, { from: string; edgeId: string } | null>;
  depth: Map<string, number>;
  /** Reached resources in BFS order, roots first. */
  order: string[];
  /** Groups whose every member is down. */
  down: Set<string>;
}

/**
 * Multi-source BFS from `roots` over the allowed confidences. From a member
 * of a redundancy group, failure flows to its consumers only once the whole
 * group is down — what runs on the member itself (placement) always goes
 * down with it. Whether a group is down can depend on what the BFS reaches
 * (two replicas on one failing host), so it repeats until the set of down
 * groups is stable — it only grows, so at most one round per group.
 */
function spread(
  adjacency: Adjacency,
  roots: readonly string[],
  allowed: ReadonlySet<Confidence>,
  maxDepth: number,
  groups: ReadonlyMap<string, string> | undefined,
  members: ReadonlyMap<string, readonly string[]>,
): Spread {
  let down = new Set<string>();
  for (;;) {
    const parent = new Map<string, { from: string; edgeId: string } | null>();
    const depth = new Map<string, number>();
    const order: string[] = [];
    for (const root of roots) {
      if (parent.has(root)) continue;
      parent.set(root, null);
      depth.set(root, 0);
      order.push(root);
    }
    for (let head = 0; head < order.length; head++) {
      const current = order[head]!;
      const d = depth.get(current)!;
      if (d >= maxDepth) continue;
      const group = groups?.get(current);
      const covered = group !== undefined && members.has(group) && !down.has(group);
      for (const next of adjacency.get(current) ?? []) {
        if (!allowed.has(next.confidence) || parent.has(next.to)) continue;
        if (covered && !next.placement) continue;
        parent.set(next.to, { from: current, edgeId: next.edgeId });
        depth.set(next.to, d + 1);
        order.push(next.to);
      }
    }
    const nowDown = new Set(
      [...members].filter(([, list]) => list.every((id) => parent.has(id))).map(([g]) => g),
    );
    if (nowDown.size === down.size) return { parent, depth, order, down };
    down = nowDown;
  }
}

function trace(s: Spread, id: string): { path: string[]; viaEdges: string[] } {
  const path = [id];
  const viaEdges: string[] = [];
  for (let step = s.parent.get(id); step; step = s.parent.get(step.from)) {
    path.unshift(step.from);
    viaEdges.unshift(step.edgeId);
  }
  return { path, viaEdges };
}

const byStrength = (a: AffectedResource, b: AffectedResource) =>
  CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
  a.depth - b.depth ||
  a.resourceId.localeCompare(b.resourceId);

/**
 * Layered spread: pass 1 uses only confirmed edges, pass 2 adds detected,
 * pass 3 adds inferred. A resource first reached in pass k gets confidence k
 * — so every resource carries the STRONGEST confidence any path offers, and
 * the fewest hops among such paths. Also returns the last (widest) pass.
 */
function layered(
  adjacency: Adjacency,
  roots: readonly string[],
  levels: readonly Confidence[],
  maxDepth: number,
  groups: ReadonlyMap<string, string> | undefined,
  members: ReadonlyMap<string, readonly string[]>,
): { affected: AffectedResource[]; widest: Spread | null } {
  const inRoots = new Set(roots);
  const assigned = new Map<string, AffectedResource>();
  let widest: Spread | null = null;
  levels.forEach((level, index) => {
    const allowed = new Set(levels.slice(0, index + 1));
    const s = spread(adjacency, roots, allowed, maxDepth, groups, members);
    widest = s;
    for (const id of s.order) {
      if (inRoots.has(id) || assigned.has(id)) continue;
      assigned.set(id, {
        resourceId: id,
        depth: s.depth.get(id)!,
        confidence: level,
        ...trace(s, id),
      });
    }
  });
  return { affected: [...assigned.values()].sort(byStrength), widest };
}

interface Blast {
  affected: AffectedResource[];
  covered: CoveredResource[];
  degraded: DegradedGroup[];
  widest: Spread | null;
  adjacency: Adjacency;
  members: Map<string, string[]>;
}

/**
 * Failure of `roots` together: what could be affected, what redundancy still
 * covers, and which groups lose redundancy. Without groups `covered` and
 * `degraded` are empty and `affected` is the plain blast radius.
 */
function blast(
  edges: readonly ImpactEdge[],
  roots: readonly string[],
  options: ImpactOptions,
): Blast {
  const maxDepth = options.maxDepth ?? 10;
  const include = new Set(options.include ?? LEVELS);
  const levels = LEVELS.filter((l) => include.has(l));
  const adjacency = buildAdjacency(edges, include);
  const members = groupMembers(options.groups);
  const result = layered(adjacency, roots, levels, maxDepth, options.groups, members);
  if (members.size === 0) return { ...result, covered: [], degraded: [], adjacency, members };

  const groups = options.groups!;
  const hit = new Set(result.widest?.order ?? roots);
  const degraded: DegradedGroup[] = [];
  for (const [group, list] of members) {
    const down = list.filter((id) => hit.has(id));
    if (down.length > 0 && down.length < list.length)
      degraded.push({ group, down, up: list.filter((id) => !hit.has(id)) });
  }
  degraded.sort((a, b) => a.group.localeCompare(b.group));
  const degradedKeys = new Set(degraded.map((d) => d.group));

  // Covered: reached when redundancy is ignored, but not with it.
  const plain = layered(adjacency, roots, levels, maxDepth, undefined, new Map());
  const affectedIds = new Set(result.affected.map((a) => a.resourceId));
  const covered: CoveredResource[] = [];
  for (const a of plain.affected) {
    if (affectedIds.has(a.resourceId)) continue;
    const via = a.path.slice(0, -1).find((id) => degradedKeys.has(groups.get(id) ?? ""));
    covered.push({ ...a, group: (via && groups.get(via)) ?? degraded[0]?.group ?? "" });
  }
  return { ...result, covered, degraded, adjacency, members };
}

/**
 * Potential blast radius of `rootId` failing (docs/ARCHITECTURE.md §6.3).
 *
 * Failure flows from a dependency to its dependents (`dependencyDirection`);
 * non-propagating types and ignored edges are skipped. Each resource carries
 * the strongest confidence any path offers, and the fewest hops among such
 * paths. Redundancy groups (M39) stop the flow while another member is up.
 * Cycle-safe; O(3 · (V + E)) per round.
 */
export function impact(
  edges: readonly ImpactEdge[],
  rootId: string,
  options: ImpactOptions = {},
): ImpactResult {
  const { affected, covered, degraded } = blast(edges, [rootId], options);
  return { rootId, affected, covered, degraded };
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
  /** As in `impact` (M39), with every changed resource down at once. */
  covered: CoveredResource[];
  degraded: DegradedGroup[];
}

/** At most this many resources in one change (keeps the computation small). */
export const CHANGE_LIMIT = 50;

/**
 * Combined blast radius of several resources changing together ("reboot
 * SQL01 and APP02 on Saturday"). They are down at the same time, which is
 * what matters for redundancy: rebooting both replicas of a group takes the
 * group down. Each resource keeps the strongest evidence and, among equally
 * strong paths, the fewest hops from any changed resource; `causes` lists
 * every changed resource that reaches it. O(k · (V + E)).
 */
export function changeImpact(
  edges: readonly ImpactEdge[],
  rootIds: readonly string[],
  options: ImpactOptions = {},
): ChangeImpactResult {
  const roots = [...new Set(rootIds)].slice(0, CHANGE_LIMIT);
  const { affected, covered, degraded, widest, adjacency, members } = blast(edges, roots, options);
  // Causes: which changed resources reach each affected one, with the groups
  // that are down in the combined failure treated as down.
  const down = widest?.down ?? new Set<string>();
  const stillUp = new Map([...members].filter(([g]) => !down.has(g)));
  const include = new Set(options.include ?? LEVELS);
  const maxDepth = options.maxDepth ?? 10;
  const reaches = roots.map(
    (root) => new Set(spread(adjacency, [root], include, maxDepth, options.groups, stillUp).order),
  );
  return {
    rootIds: roots,
    affected: affected.map((a) => ({
      ...a,
      causes: roots.filter((_, i) => reaches[i]!.has(a.resourceId)),
    })),
    covered,
    degraded,
  };
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
