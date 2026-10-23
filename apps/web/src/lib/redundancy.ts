// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Redundancy groups (M39, ADR-057): resources a human declared
 * interchangeable. Client-safe, so the map computes the same impact as the
 * server.
 */

/** Comparison key of a redundancy group: names match regardless of case. */
export function redundancyKey(group: string): string {
  return group.trim().toLowerCase();
}

/** Resource id → redundancy key, for `impact` / `changeImpact` of `@depmap/graph`. */
export function redundancyGroups(
  nodes: readonly { id: string; redundancyGroup?: string | null }[],
): Map<string, string> {
  const groups = new Map<string, string>();
  for (const n of nodes) {
    const key = n.redundancyGroup ? redundancyKey(n.redundancyGroup) : "";
    if (key) groups.set(n.id, key);
  }
  return groups;
}
