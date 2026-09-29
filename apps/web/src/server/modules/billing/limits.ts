// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import {
  BILLABLE_STATUSES,
  BILLABLE_TYPES,
  CLOUD_TIER,
  CLOUD_TRIAL_DAYS,
  COMMUNITY_WORKSPACE_LIMIT,
  OVER_LIMIT_GRACE_DAYS,
  SELF_HOSTED_HISTORY_DAYS,
  type Edition,
  type Usage,
} from "@/lib/billing-plans";
import { systemDb, tenantDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { workspaceSubscription } from "./subscriptions";
import { currentLicence } from "./licence";

const DAY = 86_400_000;

/**
 * Plan limits (ADR-023, ADR-024). Nothing is ever deleted and hosts already
 * known keep reporting. Self-hosted editions have NO server/VM limit
 * (Community is AGPL open source; Business sells capabilities, not size).
 * What limits do:
 * - Cloud: adding servers/VMs beyond the tier is refused (on paid tiers only
 *   after a grace period);
 * - a Cloud workspace whose trial ended without a plan is PAUSED: discovery
 *   (agent reports, imports, integration syncs) stops, data stays readable
 *   and exportable;
 * - members per workspace (Cloud) and workspaces per installation (Community).
 */
export class PlanLimitError extends Error {
  constructor(
    public readonly usage: Usage,
    adding: number,
  ) {
    super(
      usage.paused
        ? "The free trial of this workspace has ended. Choose a plan in Settings › Billing to continue — nothing was removed."
        : `This ${usage.scope === "instance" ? "installation" : "workspace"} is on ${usage.nodes} of ${usage.limit} servers and VMs` +
            (adding > 1 ? ` and this would add ${adding}` : "") +
            `. Change the plan in Settings › Billing to add more — nothing was removed.`,
    );
    this.name = "PlanLimitError";
  }
}

/** A Cloud trial ended without a plan: discovery is paused. */
export class PlanPausedError extends PlanLimitError {
  constructor(usage: Usage) {
    super(usage, 0);
    this.name = "PlanPausedError";
  }
}

const billableWhere = {
  type: { in: [...BILLABLE_TYPES] },
  status: { in: [...BILLABLE_STATUSES] },
};

async function countWorkspace(workspaceId: string): Promise<number> {
  return tenantDb({ workspaceId }).resource.count({ where: { workspaceId, ...billableWhere } });
}

async function countInstance(): Promise<number> {
  return systemDb("instance-wide server/VM count (self-hosted usage display)").resource.count({
    where: billableWhere,
  });
}

/** Trial end for a Cloud workspace (column, or creation + trial length). */
function trialEnd(ws: { trialEndsAt: Date | null; createdAt: Date }): Date {
  return ws.trialEndsAt ?? new Date(ws.createdAt.getTime() + CLOUD_TRIAL_DAYS * DAY);
}

/** Usage and limits that apply to a workspace under the configured edition. */
export async function getUsage(
  workspaceId: string,
  edition: Edition = getEnv().EDITION,
  now = new Date(),
): Promise<Usage> {
  if (edition === "cloud") {
    const [nodes, sub, ws] = await Promise.all([
      countWorkspace(workspaceId),
      workspaceSubscription(workspaceId),
      tenantDb({ workspaceId }).workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { trialEndsAt: true, createdAt: true, overLimitSince: true },
      }),
    ]);
    const base = { edition, nodes, scope: "workspace" as const };
    if (sub.active && sub.tier) {
      const t = CLOUD_TIER[sub.tier];
      const graceEndsAt = ws.overLimitSince
        ? new Date(ws.overLimitSince.getTime() + OVER_LIMIT_GRACE_DAYS * DAY).toISOString()
        : undefined;
      return {
        ...base,
        plan: `cloud-${sub.tier}`,
        limit: t.nodes,
        memberLimit: t.members,
        historyDays: t.historyDays,
        paused: false,
        graceEndsAt,
      };
    }
    const ends = trialEnd(ws);
    const team = CLOUD_TIER.team;
    return {
      ...base,
      plan: ends > now ? "cloud-trial" : "cloud-expired",
      limit: team.nodes,
      memberLimit: team.members,
      historyDays: team.historyDays,
      trialEndsAt: ends.toISOString(),
      paused: ends <= now,
    };
  }
  const nodes = await countInstance();
  const selfHosted = {
    edition,
    nodes,
    scope: "instance" as const,
    memberLimit: null,
    historyDays: SELF_HOSTED_HISTORY_DAYS,
    paused: false,
  };
  if (edition === "business") {
    const licence = currentLicence();
    if (licence.valid)
      return {
        ...selfHosted,
        plan: "business",
        limit: null,
        note: `Licensed to ${licence.payload.licensee} until ${licence.payload.expiresAt.slice(0, 10)}`,
      };
    // Without a valid licence the Community rules apply (one workspace).
    return { ...selfHosted, plan: "business-invalid", limit: null, note: licence.reason };
  }
  return { ...selfHosted, plan: "community", limit: null };
}

/**
 * Throws PlanLimitError if adding `adding` billable nodes is not allowed.
 * Paid Cloud tiers may go over the limit for OVER_LIMIT_GRACE_DAYS: the first
 * overflow starts the grace period (the maintenance job clears it once the
 * workspace is back under the limit).
 */
export async function assertCanAddNodes(workspaceId: string, adding: number): Promise<void> {
  if (adding <= 0) return;
  const now = new Date();
  const usage = await getUsage(workspaceId, undefined, now);
  if (usage.paused) throw new PlanPausedError(usage);
  if (usage.limit === null || usage.nodes + adding <= usage.limit) return;
  const paidCloud = usage.edition === "cloud" && usage.plan !== "cloud-trial";
  if (!paidCloud) throw new PlanLimitError(usage, adding);
  if (!usage.graceEndsAt) {
    await tenantDb({ workspaceId }).workspace.update({
      where: { id: workspaceId },
      data: { overLimitSince: now },
    });
    return;
  }
  if (new Date(usage.graceEndsAt) <= now) throw new PlanLimitError(usage, adding);
}

/** Throws PlanPausedError when discovery is paused (Cloud trial ended). */
export async function assertDiscoveryActive(workspaceId: string): Promise<void> {
  if (getEnv().EDITION !== "cloud") return;
  const usage = await getUsage(workspaceId);
  if (usage.paused) throw new PlanPausedError(usage);
}

export class MemberLimitError extends Error {
  constructor(limit: number) {
    super(
      `This plan includes ${limit} members per workspace (people and pending invitations). Change the plan in Settings › Billing to invite more.`,
    );
    this.name = "MemberLimitError";
  }
}

/** Throws MemberLimitError if `current` members + pending invitations are at the plan limit. */
export async function assertCanAddMember(workspaceId: string, current: number): Promise<void> {
  if (getEnv().EDITION !== "cloud") return;
  const { memberLimit } = await getUsage(workspaceId);
  if (memberLimit !== null && current >= memberLimit) throw new MemberLimitError(memberLimit);
}

export class InstanceWorkspaceLimitError extends Error {
  constructor() {
    super(
      `Community includes ${COMMUNITY_WORKSPACE_LIMIT} workspace per installation. A Business licence allows more — the existing workspace is unaffected.`,
    );
    this.name = "InstanceWorkspaceLimitError";
  }
}

/** Community (and Business without a valid licence): one workspace per installation. */
export async function assertCanCreateWorkspace(edition: Edition = getEnv().EDITION) {
  if (edition === "cloud") return;
  if (edition === "business" && currentLicence().valid) return;
  const count = await systemDb("instance-wide workspace count (Community limit)").workspace.count();
  if (count >= COMMUNITY_WORKSPACE_LIMIT) throw new InstanceWorkspaceLimitError();
}

/**
 * Maintenance: starts or clears the over-limit grace period of each paid
 * Cloud workspace. Returns how many changed.
 */
export async function refreshOverLimit(): Promise<{ started: number; cleared: number }> {
  if (getEnv().EDITION !== "cloud") return { started: 0, cleared: 0 };
  const rows = await systemDb("billing: over-limit grace across workspaces").workspace.findMany({
    select: { id: true, overLimitSince: true },
  });
  let started = 0;
  let cleared = 0;
  for (const row of rows) {
    const usage = await getUsage(row.id, "cloud");
    const paid = !usage.paused && usage.plan !== "cloud-trial";
    const over = paid && usage.limit !== null && usage.nodes > usage.limit;
    if (over === Boolean(row.overLimitSince)) continue;
    await tenantDb({ workspaceId: row.id }).workspace.update({
      where: { id: row.id },
      data: { overLimitSince: over ? new Date() : null },
    });
    if (over) started++;
    else cleared++;
  }
  return { started, cleared };
}
