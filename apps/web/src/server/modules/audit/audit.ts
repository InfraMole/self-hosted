// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  AUDIT_ACTIONS,
  actionsInGroup,
  type AuditAction,
  type AuditGroup,
} from "@/lib/audit-actions";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { systemDb, tenantDb, userDb } from "@/server/db";
import { requestMeta } from "@/server/request-meta";

/**
 * Security audit trail (M8c, ADR-019). Append-only (DB trigger), 365-day
 * retention. Records who did what to members, integrations, agents, the
 * workspace and billing — and sensitive reads such as exports. Ordinary page
 * views are not logged (data minimisation). Never put secrets in metadata.
 */

export const AUDIT_RETENTION_DAYS = 365;

type Db = Pick<Prisma.TransactionClient, "auditEvent" | "user">;

export interface AuditInput {
  workspaceId: string | null;
  action: AuditAction;
  actor:
    | { type: "USER"; id: string; label?: string }
    | { type: "AGENT"; id: string; label: string }
    | { type: "SYSTEM" | "OPERATOR"; id?: string; label?: string };
  target?: { type: string; id?: string; label?: string };
  metadata?: Record<string, string | number | boolean | null>;
  /** Override request metadata (e.g. Better Auth hooks, which know the session's IP). */
  meta?: { ip?: string | null; userAgent?: string | null };
}

/** Writes one event; pass the transaction client to make it atomic with the change. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  if (!(input.action in AUDIT_ACTIONS)) throw new Error(`Unknown audit action ${input.action}`);
  let label = input.actor.label ?? null;
  if (!label && input.actor.type === "USER") {
    label =
      (await db.user.findUnique({ where: { id: input.actor.id }, select: { email: true } }))
        ?.email ?? null;
  }
  const meta = input.meta
    ? { ip: input.meta.ip ?? null, userAgent: input.meta.userAgent?.slice(0, 256) ?? null }
    : await requestMeta();
  await db.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorLabel: label,
      action: input.action,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      targetLabel: input.target?.label?.slice(0, 256) ?? null,
      metadata: input.metadata ?? undefined,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
}

/** Shorthand for a user acting inside a workspace. */
export function userActor(ctx: Pick<WorkspaceContext, "userId">) {
  return { type: "USER" as const, id: ctx.userId };
}

export interface AuditEventView {
  id: string;
  createdAt: Date;
  actorType: string;
  actorLabel: string | null;
  action: AuditAction;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

const PAGE = 50;

/** ADMIN+. Newest first, cursor = id of the last event of the previous page. */
export async function listAuditEvents(
  ctx: WorkspaceContext,
  options: { group?: AuditGroup; cursor?: string } = {},
): Promise<{ events: AuditEventView[]; nextCursor: string | null }> {
  assertRole(ctx, "ADMIN");
  const rows = await tenantDb(ctx).auditEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(options.group ? { action: { in: actionsInGroup(options.group) } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      actorType: true,
      actorLabel: true,
      action: true,
      targetType: true,
      targetLabel: true,
      metadata: true,
      ip: true,
    },
  });
  const page = rows.slice(0, PAGE);
  return {
    events: page.map((r) => ({
      ...r,
      action: r.action as AuditAction,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    })),
    nextCursor: rows.length > PAGE ? page.at(-1)!.id : null,
  };
}

/** Account-level events of one user (sign-ins, 2FA…), for their security page. */
export async function listAccountEvents(userId: string, take = 20) {
  return userDb(userId).auditEvent.findMany({
    where: { workspaceId: null, actorId: userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, createdAt: true, action: true, ip: true, userAgent: true },
  });
}

/** Retention: delete events older than AUDIT_RETENTION_DAYS (the trigger allows exactly these). */
export async function pruneAuditEvents(now = new Date()): Promise<number> {
  const { count } = await systemDb("audit retention across workspaces").auditEvent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000) } },
  });
  return count;
}
