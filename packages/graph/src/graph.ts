// SPDX-License-Identifier: AGPL-3.0-only
import { RELATIONSHIP_TYPE_INFO, type RelationshipType } from "./relationship-types";

/** Minimal edge shape the algorithms need (stored direction: from TYPE to). */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
}

export type Bucket = "dependsOn" | "usedBy" | "related";

export interface Perspective {
  bucket: Bucket;
  /** The resource on the other end. */
  otherId: string;
  /** Phrase read from the viewer's side: "<viewer> <phrase> <other>". */
  phrase: string;
}

/**
 * How an edge looks from one of its endpoints. Classified by failure
 * propagation, NOT by stored direction: for `PVE01 HOSTS VM12` it is VM12 that
 * depends on PVE01.
 */
export function perspective(edge: GraphEdge, viewerId: string): Perspective {
  const info = RELATIONSHIP_TYPE_INFO[edge.type];
  const isFrom = edge.from === viewerId;
  const otherId = isFrom ? edge.to : edge.from;
  const phrase = isFrom ? info.label : info.inverseLabel;

  if (info.propagation === "none") return { bucket: "related", otherId, phrase };
  // "reverse": from depends on to.  "forward": to depends on from.
  const viewerIsDependent = info.propagation === "reverse" ? isFrom : !isFrom;
  return { bucket: viewerIsDependent ? "dependsOn" : "usedBy", otherId, phrase };
}

/**
 * Dependency orientation of an edge: `dependent → dependency`.
 * Returns null for non-propagating types. Used for layout (dependents above
 * their dependencies) and traversal.
 */
export function dependencyDirection(
  edge: GraphEdge,
): { dependent: string; dependency: string } | null {
  const { propagation } = RELATIONSHIP_TYPE_INFO[edge.type];
  if (propagation === "reverse") return { dependent: edge.from, dependency: edge.to };
  if (propagation === "forward") return { dependent: edge.to, dependency: edge.from };
  return null;
}

export type Direction = "dependsOn" | "usedBy" | "both";

export interface NeighbourhoodOptions {
  depth: number;
  direction: Direction;
  /**
   * Also include resources linked to the START node by non-propagating
   * ("related") edges, as context. They are never traversed. Default false.
   */
  includeRelated?: boolean;
}

/**
 * Resources within `depth` hops of `startId`, following dependency
 * orientation ("dependsOn" = towards dependencies, "usedBy" = towards
 * dependents). Cycle-safe BFS. Always contains startId.
 */
export function neighbourhood(
  edges: readonly GraphEdge[],
  startId: string,
  options: NeighbourhoodOptions,
): Set<string> {
  const down = new Map<string, string[]>(); // dependent -> dependencies
  const up = new Map<string, string[]>(); // dependency -> dependents
  const related = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const edge of edges) {
    const dir = dependencyDirection(edge);
    if (dir) {
      push(down, dir.dependent, dir.dependency);
      push(up, dir.dependency, dir.dependent);
    } else {
      push(related, edge.from, edge.to);
      push(related, edge.to, edge.from);
    }
  }

  const visited = new Set<string>([startId]);
  let frontier = [startId];
  for (let level = 0; level < options.depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      const candidates = [
        ...(options.direction !== "usedBy" ? (down.get(id) ?? []) : []),
        ...(options.direction !== "dependsOn" ? (up.get(id) ?? []) : []),
      ];
      for (const n of candidates) {
        if (!visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  if (options.includeRelated) {
    for (const n of related.get(startId) ?? []) visited.add(n);
  }
  return visited;
}
