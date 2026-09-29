// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plans and the billable-node rule (ADR-023 pricing, ADR-024 licensing).
 * Client-safe: the UI and the landing page show these. Prices are
 * early-access prices, not contracts.
 *
 * - Community (self-hosted, AGPL-3.0-only): free forever, unlimited servers
 *   and VMs, one workspace. You run it.
 * - Cloud: we run it; tiers are sized by servers/VMs because we host them.
 * - Business (self-hosted): enterprise capabilities, support and a commercial
 *   licence — never sized by servers/VMs.
 */
export type Edition = "community" | "cloud" | "business";

/** Only hosts count towards a Cloud plan; everything else is unlimited. */
export const BILLABLE_TYPES = ["SERVER", "VM"] as const;
export const BILLABLE_STATUSES = ["ACTIVE", "DISCOVERED"] as const;

export function isBillable(r: { type: string; status?: string | null }): boolean {
  return (
    (BILLABLE_TYPES as readonly string[]).includes(r.type) &&
    (BILLABLE_STATUSES as readonly string[]).includes(r.status ?? "ACTIVE")
  );
}

/** Community: free forever, open source, unlimited servers/VMs; one workspace per installation. */
export const COMMUNITY_WORKSPACE_LIMIT = 1;

/** Cloud: a new workspace gets the Team plan free for this long. No card needed. */
export const CLOUD_TRIAL_DAYS = 14;
/** Paid Cloud plans: going over the server/VM limit is allowed this long. */
export const OVER_LIMIT_GRACE_DAYS = 14;

export type CloudTier = "starter" | "team" | "scale";
export const CLOUD_TIERS: readonly CloudTier[] = ["starter", "team", "scale"];

export interface TierLimits {
  /** Servers and VMs (billable nodes). null = unlimited. */
  nodes: number | null;
  /** Members per workspace. null = unlimited. */
  members: number | null;
  /** Days of change history kept. */
  historyDays: number;
}

export const CLOUD_TIER: Record<CloudTier, TierLimits & { name: string; priceEur: number }> = {
  starter: { name: "Starter", priceEur: 19, nodes: 15, members: 5, historyDays: 30 },
  team: { name: "Team", priceEur: 49, nodes: 60, members: 15, historyDays: 90 },
  scale: { name: "Scale", priceEur: 99, nodes: 250, members: null, historyDays: 365 },
};

/** Business self-hosted licence: price floor shown on the landing page. */
export const BUSINESS_FROM_EUR_YEAR = 499;
/** Change history on self-hosted editions (DATA_MODEL §7). */
export const SELF_HOSTED_HISTORY_DAYS = 365;

export type PlanKey =
  | "community"
  | "cloud-trial"
  | "cloud-expired"
  | "cloud-starter"
  | "cloud-team"
  | "cloud-scale"
  | "business"
  | "business-invalid";

export const PLAN_LABEL: Record<PlanKey, string> = {
  community: "Community (self-hosted, open source)",
  "cloud-trial": "Cloud trial (Team)",
  "cloud-expired": "Cloud — trial ended",
  "cloud-starter": "Cloud Starter",
  "cloud-team": "Cloud Team",
  "cloud-scale": "Cloud Scale",
  business: "Business (licensed)",
  "business-invalid": "Business — licence missing or expired",
};

export interface Usage {
  edition: Edition;
  plan: PlanKey;
  /** Billable nodes counted in `scope`. */
  nodes: number;
  /** null = unlimited. */
  limit: number | null;
  scope: "workspace" | "instance";
  /** Members per workspace; null = unlimited. */
  memberLimit: number | null;
  historyDays: number;
  /** Cloud trial end (ISO), while on the trial or after it ended. */
  trialEndsAt?: string;
  /** Trial ended without a plan: discovery is paused, data stays readable. */
  paused: boolean;
  /** Over the limit on a paid plan: adding hosts is allowed until then (ISO). */
  graceEndsAt?: string;
  /** Short human explanation of where the limit comes from. */
  note?: string;
}

export function usageLevel(u: Pick<Usage, "nodes" | "limit">): "ok" | "near" | "at" | "over" {
  if (u.limit === null) return "ok";
  if (u.nodes > u.limit) return "over";
  if (u.nodes === u.limit) return "at";
  return u.nodes >= Math.ceil(u.limit * 0.8) ? "near" : "ok";
}

/** Whole days from `now` until `iso` (never negative). */
export function daysUntil(iso: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}
