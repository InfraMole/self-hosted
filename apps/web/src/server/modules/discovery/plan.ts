// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Discover → Suggest (docs/DISCOVERY.md §3) as a PURE function: given the
 * workspace's connection facts, resources and relationships, decide which
 * remote IPs resolve to which resource, which DETECTED relationships to create
 * and which existing relationships gain evidence. Unit tested; the DB layer
 * (discovery.ts) only executes the plan.
 */

export type RelationshipStatusLike = "CONFIRMED" | "UNCONFIRMED" | "IGNORED";

export interface FactInput {
  id: string;
  sourceResourceId: string;
  direction: "INBOUND" | "OUTBOUND";
  remoteIp: string;
  /** Server-side port (local listening port for INBOUND, remote port for OUTBOUND). */
  port: number;
  processName: string;
  sampleCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  remoteResourceId: string | null;
}

export interface ResourceIps {
  id: string;
  ipAddresses: readonly string[];
}

export interface RelationshipInput {
  id: string;
  from: string;
  to: string;
  status: RelationshipStatusLike;
}

export interface DiscoveryPlan {
  /** Facts whose resolved remote resource changed (including to null). */
  resolutions: { factId: string; remoteResourceId: string | null }[];
  /** New DETECTED/UNCONFIRMED relationships (from CONNECTS_TO to), with their facts. */
  creates: { from: string; to: string; facts: FactInput[] }[];
  /** Existing relationships (same direction) that gain/refresh evidence. */
  evidence: { relationshipId: string; facts: FactInput[] }[];
}

/** Minimum samples before a connection can become a suggestion (noise control). */
export const MIN_SAMPLES = 2;

const normalise = (ip: string) => ip.trim().toLowerCase();

/** ip -> resource ids that declare it (several = ambiguous). */
export function buildIpIndex(resources: readonly ResourceIps[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const r of resources) {
    for (const raw of new Set(r.ipAddresses.map(normalise))) {
      const list = index.get(raw);
      if (list) list.push(r.id);
      else index.set(raw, [r.id]);
    }
  }
  return index;
}

/**
 * Conservative: resolves only when exactly one OTHER resource owns the IP.
 * Ambiguous IPs (NAT, shared VIPs, stale data) stay unknown.
 */
export function resolveRemote(
  index: Map<string, string[]>,
  ip: string,
  sourceResourceId: string,
): string | null {
  const candidates = (index.get(normalise(ip)) ?? []).filter((id) => id !== sourceResourceId);
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Dependent direction of a fact: the client connects to the server. */
export function factEndpoints(fact: FactInput, remoteId: string): { from: string; to: string } {
  return fact.direction === "OUTBOUND"
    ? { from: fact.sourceResourceId, to: remoteId }
    : { from: remoteId, to: fact.sourceResourceId };
}

export function planDiscovery(
  facts: readonly FactInput[],
  resources: readonly ResourceIps[],
  relationships: readonly RelationshipInput[],
  minSamples = MIN_SAMPLES,
): DiscoveryPlan {
  const index = buildIpIndex(resources);
  const known = new Set(resources.map((r) => r.id));
  const plan: DiscoveryPlan = { resolutions: [], creates: [], evidence: [] };

  const byPair = new Map<string, { from: string; to: string; facts: FactInput[] }>();
  for (const fact of facts) {
    if (!known.has(fact.sourceResourceId)) continue; // host archived/deleted
    const remote = resolveRemote(index, fact.remoteIp, fact.sourceResourceId);
    if (remote !== fact.remoteResourceId) {
      plan.resolutions.push({ factId: fact.id, remoteResourceId: remote });
    }
    if (!remote || fact.sampleCount < minSamples) continue;
    const { from, to } = factEndpoints(fact, remote);
    const key = `${from}|${to}`;
    const entry = byPair.get(key) ?? { from, to, facts: [] };
    entry.facts.push(fact);
    byPair.set(key, entry);
  }

  const relsByPair = new Map<string, RelationshipInput[]>();
  for (const r of relationships) {
    const key = `${r.from}|${r.to}`;
    relsByPair.set(key, [...(relsByPair.get(key) ?? []), r]);
  }
  const rank: Record<RelationshipStatusLike, number> = { CONFIRMED: 0, UNCONFIRMED: 1, IGNORED: 2 };

  for (const pair of byPair.values()) {
    const forward = relsByPair.get(`${pair.from}|${pair.to}`) ?? [];
    const reverse = relsByPair.get(`${pair.to}|${pair.from}`) ?? [];
    if (forward.length > 0) {
      // Already represented. IGNORED-only pairs are never re-suggested nor touched.
      const target = [...forward].sort((a, b) => rank[a.status] - rank[b.status])[0]!;
      if (target.status !== "IGNORED")
        plan.evidence.push({ relationshipId: target.id, facts: pair.facts });
      continue;
    }
    if (reverse.length > 0) continue; // a human described it the other way round
    plan.creates.push(pair);
  }
  return plan;
}
