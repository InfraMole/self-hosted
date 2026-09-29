// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { Prisma, ResourceStatus } from "@/generated/prisma/client";
import { tenantDb } from "@/server/db";
import { recordAgentChange } from "@/server/modules/changes/changes";
import { isStale } from "./host-changes";

/**
 * Staleness without a scheduler (ADR-016): checked opportunistically on every
 * agent report and when key pages load, at most once per minute per workspace
 * and process.
 */
const THROTTLE_MS = 60_000;
const lastRun = new Map<string, number>();

/** Marks hosts whose agent stopped reporting as STALE + NO_LONGER_OBSERVED. */
export async function markStaleHosts(
  workspaceId: string,
  { now = new Date(), force = false }: { now?: Date; force?: boolean } = {},
): Promise<number> {
  const previous = lastRun.get(workspaceId) ?? 0;
  if (!force && now.getTime() - previous < THROTTLE_MS) return 0;
  lastRun.set(workspaceId, now.getTime());

  const db = tenantDb({ workspaceId });
  const agents = await db.agent.findMany({
    where: { workspaceId, status: "ACTIVE", lastSeenAt: { not: null }, resourceId: { not: null } },
    select: {
      id: true,
      lastSeenAt: true,
      reportIntervalSec: true,
      resource: { select: { id: true, name: true, status: true } },
    },
  });

  let marked = 0;
  for (const agent of agents) {
    const r = agent.resource;
    if (!r || r.status === "STALE" || r.status === "ARCHIVED") continue;
    if (!isStale(agent.lastSeenAt, agent.reportIntervalSec, now)) continue;
    await db.$transaction(async (tx) => {
      // Re-check inside the transaction (another request may have handled it).
      const { count } = await tx.resource.updateMany({
        where: { id: r.id, workspaceId, status: r.status },
        data: { status: "STALE" },
      });
      if (count === 0) return;
      await tx.changeEvent.create({
        data: {
          workspaceId,
          actorType: "SYSTEM",
          subjectType: "RESOURCE",
          subjectId: r.id,
          subjectLabel: r.name,
          kind: "NO_LONGER_OBSERVED",
          summary: `${r.name} is no longer reporting (last seen ${agent.lastSeenAt!.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
          diff: { status: [r.status, "STALE"] },
        },
      });
      marked++;
    });
  }
  return marked;
}

/**
 * Called when a STALE host reports again: restores the status it had before
 * (read from the NO_LONGER_OBSERVED event), default DISCOVERED.
 */
export async function restoreFromStale(
  tx: Prisma.TransactionClient,
  resource: { id: string; name: string; workspaceId: string },
  agentId: string,
): Promise<void> {
  const event = await tx.changeEvent.findFirst({
    where: {
      workspaceId: resource.workspaceId,
      subjectType: "RESOURCE",
      subjectId: resource.id,
      kind: "NO_LONGER_OBSERVED",
    },
    orderBy: { occurredAt: "desc" },
    select: { diff: true },
  });
  const before = (event?.diff as { status?: [string, string] } | null)?.status?.[0];
  const restored: ResourceStatus = before === "ACTIVE" ? "ACTIVE" : "DISCOVERED";
  await tx.resource.update({ where: { id: resource.id }, data: { status: restored } });
  await recordAgentChange(tx, resource.workspaceId, agentId, {
    subjectType: "RESOURCE",
    subjectId: resource.id,
    subjectLabel: resource.name,
    kind: "UPDATED",
    summary: `${resource.name} is reporting again`,
    diff: { status: ["STALE", restored] },
  });
}

/** Test helper. */
export function resetStalenessThrottle() {
  lastRun.clear();
}
