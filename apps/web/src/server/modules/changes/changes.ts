// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import {
  ChangeKind as ChangeKindEnum,
  type ChangeKind,
  type ChangeSubjectType,
} from "@/generated/prisma/enums";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";

export interface ChangeInput {
  subjectType: ChangeSubjectType;
  subjectId: string;
  subjectLabel: string;
  kind: ChangeKind;
  summary: string;
  diff?: Prisma.InputJsonValue;
  /** Other resources this change concerns (shown in their Activity too). */
  resourceIds?: string[];
}

/**
 * Appends a ChangeEvent made by the current user. Must be called with the
 * transaction client of the mutation it describes (ADR-009).
 */
export async function recordUserChange(
  tx: Prisma.TransactionClient,
  ctx: WorkspaceContext,
  change: ChangeInput,
) {
  await tx.changeEvent.create({
    data: { ...change, workspaceId: ctx.workspaceId, actorType: "USER", actorId: ctx.userId },
  });
}

/** Appends a ChangeEvent made by a discovery agent (same transaction rule). */
export async function recordAgentChange(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  agentId: string,
  change: ChangeInput,
) {
  await tx.changeEvent.create({
    data: { ...change, workspaceId, actorType: "AGENT", actorId: agentId },
  });
}

export interface ChangeView {
  id: string;
  occurredAt: Date;
  subjectType: ChangeSubjectType;
  subjectId: string;
  subjectLabel: string;
  kind: ChangeKind;
  summary: string;
  diff: unknown;
  actorType: string;
  /** User name, or the agent's hostname. */
  actorName: string | null;
  /** Resource to link to (subject or first related resource), if it still exists. */
  linkResourceId: string | null;
}

/** Activity for one subject, newest first, with actor display names. */
export async function listChangesForSubject(
  ctx: WorkspaceContext,
  subjectType: ChangeSubjectType,
  subjectId: string,
  limit = 100,
): Promise<ChangeView[]> {
  const events = await tenantDb(ctx).changeEvent.findMany({
    where: { workspaceId: ctx.workspaceId, subjectType, subjectId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return present(ctx.workspaceId, events);
}

/** Activity of a resource: its own events plus events that concern it (e.g. relationships). */
export async function listChangesForResource(
  ctx: WorkspaceContext,
  resourceId: string,
  limit = 100,
): Promise<ChangeView[]> {
  const events = await tenantDb(ctx).changeEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [
        { subjectType: "RESOURCE", subjectId: resourceId },
        { resourceIds: { has: resourceId } },
      ],
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return present(ctx.workspaceId, events);
}

// ───────────────────────── Workspace feed (M7) ─────────────────────────

export const CHANGE_PERIODS = [1, 7, 30] as const;
export const FEED_PAGE_SIZE = 100;

export const changesFilterSchema = z.object({
  days: z.coerce
    .number()
    .refine((d) => (CHANGE_PERIODS as readonly number[]).includes(d))
    .catch(7),
  actor: z.enum(["all", "human", "agent", "import", "system"]).catch("all"),
  kind: z.enum(ChangeKindEnum).optional().catch(undefined),
  cursor: z.string().max(64).optional().catch(undefined),
});
export type ChangesFilter = z.infer<typeof changesFilterSchema>;

const ACTOR_TYPES = {
  human: "USER",
  agent: "AGENT",
  import: "IMPORTER",
  system: "SYSTEM",
} as const;

export interface ChangesPage {
  filter: ChangesFilter;
  events: ChangeView[];
  nextCursor: string | null;
  /** Counts per kind for the period + actor filter (ignores kind/cursor). */
  counts: Partial<Record<ChangeKind, number>>;
}

/** "What's changed?" — newest first, cursor-paginated. */
export async function listWorkspaceChanges(
  ctx: WorkspaceContext,
  rawFilter: unknown,
  now = new Date(),
): Promise<ChangesPage> {
  const filter = changesFilterSchema.parse(rawFilter ?? {});
  const base: Prisma.ChangeEventWhereInput = {
    workspaceId: ctx.workspaceId,
    occurredAt: { gte: new Date(now.getTime() - filter.days * 86_400_000) },
    ...(filter.actor !== "all" ? { actorType: ACTOR_TYPES[filter.actor] } : {}),
  };
  const db = tenantDb(ctx);
  const [rows, grouped] = await Promise.all([
    db.changeEvent.findMany({
      where: { ...base, ...(filter.kind ? { kind: filter.kind } : {}) },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: FEED_PAGE_SIZE + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    }),
    db.changeEvent.groupBy({ by: ["kind"], where: base, _count: { _all: true } }),
  ]);
  const page = rows.slice(0, FEED_PAGE_SIZE);
  return {
    filter,
    events: await present(ctx.workspaceId, page),
    nextCursor: rows.length > FEED_PAGE_SIZE ? page[page.length - 1]!.id : null,
    counts: Object.fromEntries(grouped.map((g) => [g.kind, g._count._all])),
  };
}

type EventRow = Awaited<ReturnType<ReturnType<typeof tenantDb>["changeEvent"]["findMany"]>>[number];

/** Adds actor display names and still-valid resource links. */
async function present(workspaceId: string, events: EventRow[]): Promise<ChangeView[]> {
  const db = tenantDb({ workspaceId });
  const ids = (type: string) => [
    ...new Set(events.filter((e) => e.actorType === type && e.actorId).map((e) => e.actorId!)),
  ];
  const candidateResources = [
    ...new Set(
      events.flatMap((e) =>
        e.subjectType === "RESOURCE" ? [e.subjectId] : e.resourceIds.slice(0, 1),
      ),
    ),
  ];
  const [users, agents, resources] = await Promise.all([
    ids("USER").length
      ? db.user.findMany({ where: { id: { in: ids("USER") } }, select: { id: true, name: true } })
      : [],
    ids("AGENT").length
      ? db.agent.findMany({
          where: { id: { in: ids("AGENT") }, workspaceId },
          select: { id: true, hostname: true },
        })
      : [],
    candidateResources.length
      ? db.resource.findMany({
          where: { id: { in: candidateResources }, workspaceId },
          select: { id: true },
        })
      : [],
  ]);
  const names = new Map<string, string>([
    ...users.map((u) => [u.id, u.name] as const),
    ...agents.map((a) => [a.id, a.hostname] as const),
  ]);
  const existing = new Set(resources.map((r) => r.id));

  return events.map((e) => {
    const target = e.subjectType === "RESOURCE" ? e.subjectId : e.resourceIds[0];
    return {
      id: e.id,
      occurredAt: e.occurredAt,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      subjectLabel: e.subjectLabel,
      kind: e.kind,
      summary: e.summary,
      diff: e.diff,
      actorType: e.actorType,
      actorName:
        e.actorType === "IMPORTER" ? e.actorId : e.actorId ? (names.get(e.actorId) ?? null) : null,
      linkResourceId: target && existing.has(target) ? target : null,
    };
  });
}
