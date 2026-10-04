// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { PAUSE_NOTICE_DAYS_LEFT, PAUSED_RETENTION_DAYS, type Edition } from "@/lib/billing-plans";
import { systemDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { sendMail } from "@/server/mail";
import { recordAudit } from "@/server/modules/audit/audit";
import { getUsage } from "./limits";

const DAY = 86_400_000;

export interface PausedOutcome {
  paused: number;
  resumed: number;
  notices: number;
  deleted: number;
}

/**
 * Retention of paused Cloud workspaces (M32, ADR-046), from the maintenance
 * job. A workspace without an active plan after its trial is paused: the
 * clock starts the first time this job sees it paused, owners are emailed
 * when 30 and 7 days remain, and after PAUSED_RETENTION_DAYS it is deleted
 * like an owner deletion. Choosing a plan at any point stops the clock.
 * Community and Business never delete anything.
 */
export async function retirePausedWorkspaces(
  now = new Date(),
  edition: Edition = getEnv().EDITION,
): Promise<PausedOutcome> {
  const out: PausedOutcome = { paused: 0, resumed: 0, notices: 0, deleted: 0 };
  if (edition !== "cloud") return out;
  const db = systemDb("paused Cloud workspaces: retention across workspaces");
  const workspaces = await db.workspace.findMany({
    select: { id: true, name: true, slug: true, pausedSince: true, pauseNoticesSent: true },
  });
  for (const ws of workspaces) {
    const usage = await getUsage(ws.id, "cloud", now);
    if (!usage.paused) {
      if (ws.pausedSince) {
        await db.workspace.update({
          where: { id: ws.id },
          data: { pausedSince: null, pauseNoticesSent: 0 },
        });
        out.resumed++;
      }
      continue;
    }
    out.paused++;
    const since = ws.pausedSince ?? now;
    if (!ws.pausedSince)
      await db.workspace.update({ where: { id: ws.id }, data: { pausedSince: since } });
    const deletesAt = new Date(since.getTime() + PAUSED_RETENTION_DAYS * DAY);
    const daysLeft = Math.ceil((deletesAt.getTime() - now.getTime()) / DAY);

    if (daysLeft <= 0) {
      await db.$transaction(async (tx) => {
        // Lets the cascade remove this workspace's audit rows (append-only trigger).
        await tx.$executeRaw`SELECT set_config('depmap.allow_audit_delete', 'on', true)`;
        await tx.workspace.delete({ where: { id: ws.id } });
        await recordAudit(tx, {
          workspaceId: null,
          action: "workspace.deleted",
          actor: { type: "SYSTEM", label: "Retention of paused workspaces" },
          target: { type: "workspace", id: ws.id, label: ws.name },
          metadata: { reason: "paused", pausedSince: since.toISOString() },
          meta: { ip: null, userAgent: null },
        });
      });
      out.deleted++;
      continue;
    }

    const level = PAUSE_NOTICE_DAYS_LEFT.filter((d) => daysLeft <= d).length;
    if (level > ws.pauseNoticesSent) {
      const owners = await db.membership.findMany({
        where: { workspaceId: ws.id, role: "OWNER" },
        select: { user: { select: { email: true, name: true } } },
      });
      const base = getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
      for (const { user } of owners)
        await sendMail(pausedNotice(user.email, user.name, ws, since, deletesAt, daysLeft, base));
      await db.workspace.update({ where: { id: ws.id }, data: { pauseNoticesSent: level } });
      out.notices += owners.length;
    }
  }
  return out;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function pausedNotice(
  to: string,
  name: string,
  ws: { name: string; slug: string },
  since: Date,
  deletesAt: Date,
  daysLeft: number,
  base: string,
) {
  return {
    to,
    subject: `“${ws.name}” will be deleted in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
    text: [
      `Hello ${name},`,
      "",
      `Your InfraMole workspace “${ws.name}” has been paused since ${day(since)} because it has no active plan.`,
      `On ${day(deletesAt)} it will be deleted, with everything in it.`,
      "",
      `To keep it, choose a plan: ${base}/w/${ws.slug}/settings/billing`,
      `To keep a copy of your data, export it: ${base}/w/${ws.slug}/settings#data`,
      "",
      "If you do not need it any more, there is nothing to do.",
      "",
      "— InfraMole",
    ].join("\n"),
  };
}
