// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { getDb, systemDb } from "@/server/db";
import { AUDIT_RETENTION_DAYS, pruneAuditEvents } from "@/server/modules/audit/audit";
import { OBSERVATION_RETENTION_DAYS } from "@/server/modules/agents/ingestion";
import { getUsage } from "@/server/modules/billing/limits";
import { getEnv } from "@/server/env";
import { FACT_RETENTION_DAYS } from "@/server/modules/discovery/discovery";

/**
 * Retention policy (M8c) — docs/DATA_MODEL.md §7 is the reference. Runs from
 * POST /api/cron/maintenance (cron service). Idempotent; returns counts.
 * Per-agent pruning also happens opportunistically on each report, but only
 * this job covers revoked agents and data nobody touches any more.
 */
export const RETENTION = {
  observationDays: OBSERVATION_RETENTION_DAYS, // raw agent reports
  connectionFactDays: FACT_RETENTION_DAYS, // since last seen
  changeEventDays: 365, // maximum; Cloud tiers keep less (planHistory below)
  auditDays: AUDIT_RETENTION_DAYS,
  endedInvitationDays: 30, // after accepted / revoked / expired (they hold emails)
  endedEnrollmentTokenDays: 90, // after revoked / expired
  endedApiTokenDays: 90, // read-only API tokens (M30), after revoked / expired
  endedShareDays: 90, // public map links (M31), after revoked / expired
  revokedAgentDays: 90, // revoked agents keep their last IP until then
  suggestionDays: 30, // unreviewed agent suggestions not observed since (M15)
} as const;

const DAY = 86_400_000;

export async function runRetention(now = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const db = systemDb("retention policy across workspaces");
  const [
    observations,
    connectionFacts,
    changeEvents,
    invitations,
    enrollmentTokens,
    agents,
    apiTokens,
    shares,
  ] = await Promise.all([
    db.observation.deleteMany({
      where: { receivedAt: { lt: before(RETENTION.observationDays) } },
    }),
    db.connectionFact.deleteMany({
      where: { lastSeenAt: { lt: before(RETENTION.connectionFactDays) } },
    }),
    db.changeEvent.deleteMany({
      where: { occurredAt: { lt: before(RETENTION.changeEventDays) } },
    }),
    db.invitation.deleteMany({
      where: {
        OR: [
          { acceptedAt: { lt: before(RETENTION.endedInvitationDays) } },
          { revokedAt: { lt: before(RETENTION.endedInvitationDays) } },
          { expiresAt: { lt: before(RETENTION.endedInvitationDays) } },
        ],
      },
    }),
    db.enrollmentToken.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: before(RETENTION.endedEnrollmentTokenDays) } },
          { expiresAt: { lt: before(RETENTION.endedEnrollmentTokenDays) } },
        ],
      },
    }),
    db.agent.deleteMany({
      where: { status: "REVOKED", revokedAt: { lt: before(RETENTION.revokedAgentDays) } },
    }),
    db.apiToken.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: before(RETENTION.endedApiTokenDays) } },
          { expiresAt: { lt: before(RETENTION.endedApiTokenDays) } },
        ],
      },
    }),
    db.mapShare.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: before(RETENTION.endedShareDays) } },
          { expiresAt: { lt: before(RETENTION.endedShareDays) } },
        ],
      },
    }),
  ]);
  // Auth tables (no RLS): expired sessions and verification / reset tokens.
  const [sessions, verifications] = await Promise.all([
    getDb().session.deleteMany({ where: { expiresAt: { lt: now } } }),
    getDb().verification.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  const audit = await pruneAuditEvents(now);
  const suggestions = await expireSuggestions(before(RETENTION.suggestionDays));
  const planHistory = await prunePlanHistory(now);
  return {
    observations: observations.count,
    connectionFacts: connectionFacts.count,
    changeEvents: changeEvents.count + planHistory,
    invitations: invitations.count,
    enrollmentTokens: enrollmentTokens.count,
    apiTokens: apiTokens.count,
    shares: shares.count,
    agents: agents.count,
    sessions: sessions.count,
    verifications: verifications.count,
    auditEvents: audit,
    expiredSuggestions: suggestions,
  };
}

/**
 * M15 (ADR-027): an unreviewed suggestion that agents have not observed for
 * 30 days is removed — its connection facts are gone too. Only agent-observed
 * suggestions expire (`lastObservedAt` set); import-made ones stay until
 * reviewed. Each removal is a SYSTEM change event.
 */
async function expireSuggestions(cutoff: Date): Promise<number> {
  const db = systemDb("retention: expire unreviewed agent suggestions");
  const stale = await db.relationship.findMany({
    where: { status: "UNCONFIRMED", origin: "DETECTED", lastObservedAt: { lt: cutoff } },
    select: {
      id: true,
      workspaceId: true,
      fromResourceId: true,
      toResourceId: true,
      from: { select: { name: true } },
      to: { select: { name: true } },
    },
    take: 5000,
  });
  if (stale.length === 0) return 0;
  await db.$transaction(async (tx) => {
    await tx.relationship.deleteMany({
      where: { id: { in: stale.map((r) => r.id) }, status: "UNCONFIRMED" },
    });
    await tx.changeEvent.createMany({
      data: stale.map((r) => {
        const label = `${r.from.name} → ${r.to.name}`;
        return {
          workspaceId: r.workspaceId,
          actorType: "SYSTEM" as const,
          subjectType: "RELATIONSHIP" as const,
          subjectId: r.id,
          subjectLabel: label,
          kind: "DELETED" as const,
          summary: `Suggestion expired (not observed for ${RETENTION.suggestionDays} days): ${label}`,
          resourceIds: [r.fromResourceId, r.toResourceId],
        };
      }),
    });
  });
  return stale.length;
}

/**
 * Cloud (ADR-023): change history is kept for the workspace's plan
 * (Starter 30 days, Team and the trial 90, Scale 365). One pass per workspace.
 */
async function prunePlanHistory(now: Date): Promise<number> {
  if (getEnv().EDITION !== "cloud") return 0;
  const workspaces = await systemDb("retention: workspaces for plan history").workspace.findMany({
    select: { id: true },
  });
  let deleted = 0;
  for (const { id } of workspaces) {
    const { historyDays } = await getUsage(id, "cloud", now);
    if (historyDays >= RETENTION.changeEventDays) continue;
    const { count } = await systemDb("retention: plan history").changeEvent.deleteMany({
      where: { workspaceId: id, occurredAt: { lt: new Date(now.getTime() - historyDays * DAY) } },
    });
    deleted += count;
  }
  return deleted;
}
