// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Mail } from "@/server/mail";

/**
 * Weekly change digest (M21, ADR-032) — PURE parts: when a digest is due,
 * what it says, and the signed unsubscribe link. Unit tested.
 */

/** Digests go out on Mondays from this hour (UTC). */
export const DIGEST_HOUR_UTC = 6;

/** The Monday 06:00 UTC at or before `now`: the end of the reported week. */
export function weekStart(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC),
  );
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  if (d > now) d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

/** Due when nothing was sent since the last Monday 06:00 UTC. */
export function digestDue(sentAt: Date | null, now: Date): boolean {
  return !sentAt || sentAt < weekStart(now);
}

export type DigestKind =
  "CREATED" | "UPDATED" | "DELETED" | "DISCOVERED" | "CONFIRMED" | "IGNORED" | "NO_LONGER_OBSERVED";

const KIND_LABEL: Record<DigestKind, string> = {
  DISCOVERED: "discovered",
  CREATED: "created",
  UPDATED: "updated",
  CONFIRMED: "confirmed",
  IGNORED: "ignored",
  DELETED: "deleted",
  NO_LONGER_OBSERVED: "stopped reporting",
};

export interface DigestData {
  workspaceName: string;
  from: Date;
  to: Date;
  counts: Partial<Record<DigestKind, number>>;
  topResources: { name: string; changes: number }[];
  suggestionsWaiting: number;
  staleResources: number;
  changesUrl: string;
  suggestionsUrl: string;
  unsubscribeUrl: string;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 120);
const day = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

/**
 * Plain text, like every InfraMole email. Counts and resource names only —
 * never IP addresses, change details or anything that is not already a name
 * the member can see. Null when there is nothing to say (no email is sent).
 */
export function renderDigest(to: string, d: DigestData): Mail | null {
  const total = Object.values(d.counts).reduce((a, b) => a + (b ?? 0), 0);
  if (total === 0 && d.suggestionsWaiting === 0 && d.staleResources === 0) return null;
  const ws = oneLine(d.workspaceName);
  const lines: string[] = [
    `Weekly summary for "${ws}" — ${day(d.from)} to ${day(d.to)}`,
    "",
    total === 0 ? "No changes this week." : `${total} change${total === 1 ? "" : "s"} this week:`,
  ];
  for (const kind of Object.keys(KIND_LABEL) as DigestKind[]) {
    const n = d.counts[kind];
    if (n) lines.push(`  • ${n} ${KIND_LABEL[kind]}`);
  }
  if (d.topResources.length) {
    lines.push("", "Most changed resources:");
    for (const r of d.topResources)
      lines.push(`  • ${oneLine(r.name)} — ${r.changes} change${r.changes === 1 ? "" : "s"}`);
  }
  if (d.suggestionsWaiting || d.staleResources) {
    lines.push("", "Waiting for you:");
    if (d.suggestionsWaiting)
      lines.push(
        `  • ${d.suggestionsWaiting} suggestion${d.suggestionsWaiting === 1 ? "" : "s"} to review: ${d.suggestionsUrl}`,
      );
    if (d.staleResources)
      lines.push(
        `  • ${d.staleResources} resource${d.staleResources === 1 ? "" : "s"} no longer reporting (stale)`,
      );
  }
  lines.push(
    "",
    `See every change: ${d.changesUrl}`,
    "",
    `You receive this because you turned on the weekly summary for "${ws}".`,
    `Stop these emails: ${d.unsubscribeUrl}`,
    "",
    "— InfraMole · See what depends on what.",
  );
  return {
    to,
    subject: `${ws}: ${total} change${total === 1 ? "" : "s"} this week`,
    text: lines.join("\n"),
    unsubscribeUrl: d.unsubscribeUrl,
  };
}

/** Signed, login-free unsubscribe token for one membership. */
export function unsubscribeToken(secret: string, membershipId: string): string {
  return createHmac("sha256", secret)
    .update(`digest-unsubscribe:${membershipId}`)
    .digest("base64url");
}

export function validUnsubscribeToken(
  secret: string,
  membershipId: string,
  token: string,
): boolean {
  const want = Buffer.from(unsubscribeToken(secret, membershipId));
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
