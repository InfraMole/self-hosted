// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { WorkspaceContext } from "@/server/authz";
import { systemDb, tenantDb, userDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { mailerConfigured, sendMail } from "@/server/mail";
import {
  digestDue,
  renderDigest,
  unsubscribeToken,
  validUnsubscribeToken,
  weekStart,
  type DigestData,
  type DigestKind,
} from "./digest-pure";

/**
 * Weekly change digest (M21, ADR-032): opt-in per member and workspace, sent
 * by the cron job on Mondays. Not an alert: a summary of what changed.
 */

const WEEK = 7 * 86_400_000;
/** At most this many emails per cron run; the rest go on the next run. */
export const DIGEST_BATCH = 200;

export interface DigestPreference {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  weeklyDigest: boolean;
}

/** The signed-in user's setting in each of their workspaces. */
export async function listDigestPreferences(userId: string): Promise<DigestPreference[]> {
  const rows = await userDb(userId).membership.findMany({
    where: { userId },
    select: {
      weeklyDigest: true,
      workspace: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    workspaceId: r.workspace.id,
    workspaceName: r.workspace.name,
    workspaceSlug: r.workspace.slug,
    weeklyDigest: r.weeklyDigest,
  }));
}

/**
 * Turns the digest on or off for the current user in this workspace (any
 * role: it is a personal preference). Turning it on marks it as "sent now",
 * so the first email is the next Monday's.
 */
export async function setWeeklyDigest(ctx: WorkspaceContext, enabled: boolean): Promise<void> {
  await tenantDb(ctx).membership.updateMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    data: { weeklyDigest: enabled, digestSentAt: enabled ? new Date() : null },
  });
}

function appOrigin(): string {
  return new URL(getEnv().BETTER_AUTH_URL).origin;
}

export function unsubscribeUrl(membershipId: string): string {
  const token = unsubscribeToken(getEnv().BETTER_AUTH_SECRET, membershipId);
  return `${appOrigin()}/api/digest/unsubscribe?m=${encodeURIComponent(membershipId)}&t=${token}`;
}

/** Login-free unsubscribe (signed link). Returns the workspace name, or null. */
export async function unsubscribeDigest(
  membershipId: string,
  token: string,
): Promise<string | null> {
  if (!membershipId || membershipId.length > 64 || !token || token.length > 128) return null;
  if (!validUnsubscribeToken(getEnv().BETTER_AUTH_SECRET, membershipId, token)) return null;
  const db = systemDb("digest: unsubscribe via signed link");
  const row = await db.membership.findUnique({
    where: { id: membershipId },
    select: { id: true, workspace: { select: { name: true } } },
  });
  if (!row) return null;
  await db.membership.update({ where: { id: row.id }, data: { weeklyDigest: false } });
  return row.workspace.name;
}

/** What happened in one workspace during [from, to). */
export async function collectDigest(
  workspace: { id: string; name: string; slug: string },
  from: Date,
  to: Date,
  membershipId: string,
): Promise<DigestData> {
  const db = tenantDb({ workspaceId: workspace.id });
  const [events, suggestionsWaiting, staleResources] = await Promise.all([
    db.changeEvent.findMany({
      where: { workspaceId: workspace.id, occurredAt: { gte: from, lt: to } },
      select: { kind: true, subjectType: true, subjectId: true, subjectLabel: true },
      take: 50_000,
    }),
    db.relationship.count({ where: { workspaceId: workspace.id, status: "UNCONFIRMED" } }),
    db.resource.count({ where: { workspaceId: workspace.id, status: "STALE" } }),
  ]);
  const counts: Partial<Record<DigestKind, number>> = {};
  const byResource = new Map<string, { name: string; changes: number }>();
  for (const e of events) {
    counts[e.kind as DigestKind] = (counts[e.kind as DigestKind] ?? 0) + 1;
    if (e.subjectType === "RESOURCE") {
      const r = byResource.get(e.subjectId) ?? { name: e.subjectLabel, changes: 0 };
      r.changes++;
      byResource.set(e.subjectId, r);
    }
  }
  const origin = appOrigin();
  return {
    workspaceName: workspace.name,
    from,
    to,
    counts,
    topResources: [...byResource.values()]
      .sort((a, b) => b.changes - a.changes || a.name.localeCompare(b.name))
      .slice(0, 5),
    suggestionsWaiting,
    staleResources,
    changesUrl: `${origin}/w/${workspace.slug}/changes`,
    suggestionsUrl: `${origin}/w/${workspace.slug}/suggestions`,
    unsubscribeUrl: unsubscribeUrl(membershipId),
  };
}

/**
 * Cron (POST /api/cron/digest): sends the digests that are due. Idempotent
 * per week (`digestSentAt`); a failure for one member never stops the others
 * and is logged without the email body.
 */
export async function sendDueDigests(
  now = new Date(),
): Promise<{ sent: number; empty: number; failed: number; skipped?: string }> {
  if (!mailerConfigured()) return { sent: 0, empty: 0, failed: 0, skipped: "mail not configured" };
  const to = weekStart(now);
  const from = new Date(to.getTime() - WEEK);
  const db = systemDb("digest: memberships due this week, across workspaces");
  const due = await db.membership.findMany({
    where: { weeklyDigest: true, OR: [{ digestSentAt: null }, { digestSentAt: { lt: to } }] },
    select: {
      id: true,
      digestSentAt: true,
      user: { select: { email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { digestSentAt: { sort: "asc", nulls: "first" } },
    take: DIGEST_BATCH,
  });
  let sent = 0;
  let empty = 0;
  let failed = 0;
  for (const m of due) {
    if (!digestDue(m.digestSentAt, now)) continue;
    try {
      const mail = renderDigest(m.user.email, await collectDigest(m.workspace, from, to, m.id));
      if (mail) {
        await sendMail(mail);
        sent++;
      } else empty++;
      await db.membership.update({ where: { id: m.id }, data: { digestSentAt: now } });
    } catch (error) {
      failed++;
      console.warn(
        `[digest] membership ${m.id} not sent:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return { sent, empty, failed };
}
