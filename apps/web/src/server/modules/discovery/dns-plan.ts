// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DNS servers → suggestions (M39). Pure: decides what to create, refresh and
 * drop for one host from the resolvers its agent reports. A configured
 * resolver is configuration, not observed traffic: suggestions are
 * INFERRED and carry DNS_RESOLVER evidence, never connection evidence.
 */
import { isExcluded, resolveRemote, type RuleInput } from "./plan";

/** DNS evidence is port 53 without a process, for the exclusion rules. */
export const DNS_PORT = 53;

export interface HostRelationship {
  id: string;
  to: string;
  type: string;
  status: "CONFIRMED" | "UNCONFIRMED" | "IGNORED";
  /** It carries DNS_RESOLVER evidence. */
  dns: boolean;
  /** It carries any other evidence (observed connections). */
  other: boolean;
}

export interface DnsPlan {
  /** New INFERRED DEPENDS_ON suggestions host → target. */
  create: string[];
  /** Existing relationships that gain or refresh DNS_RESOLVER evidence. */
  refresh: string[];
  /** Unreviewed suggestions explained only by a resolver no longer configured. */
  drop: string[];
  /** Relationships that keep existing but lose their DNS_RESOLVER evidence. */
  strip: string[];
}

/**
 * Resolution is as conservative as for connections: a resolver becomes a
 * target only when exactly one other resource declares its IP, and not when
 * an exclusion rule matches port 53 (or either resource). Any existing
 * relationship host → target (any type or status, also IGNORED) is reused,
 * so a human decision is never overridden.
 */
export function planDnsSuggestions(
  hostId: string,
  servers: readonly string[],
  ipIndex: Map<string, string[]>,
  fromHost: readonly HostRelationship[],
  rules: readonly RuleInput[] = [],
): DnsPlan {
  const targets = new Set<string>();
  for (const ip of servers) {
    const target = resolveRemote(ipIndex, ip, hostId);
    const evidence = { port: DNS_PORT, processName: "", sourceResourceId: hostId };
    if (target && !isExcluded(evidence, target, rules)) targets.add(target);
  }
  const plan: DnsPlan = { create: [], refresh: [], drop: [], strip: [] };
  for (const target of targets) {
    const pair = fromHost.filter((r) => r.to === target);
    if (pair.length === 0) {
      plan.create.push(target);
      continue;
    }
    const chosen = pair.find((r) => r.dns) ?? pair.find((r) => r.type === "DEPENDS_ON") ?? pair[0]!;
    plan.refresh.push(chosen.id);
  }
  for (const r of fromHost) {
    if (!r.dns || (targets.has(r.to) && plan.refresh.includes(r.id))) continue;
    if (r.status === "UNCONFIRMED" && !r.other) plan.drop.push(r.id);
    else plan.strip.push(r.id);
  }
  return plan;
}
