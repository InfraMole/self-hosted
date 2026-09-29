// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { recordUserChange } from "@/server/modules/changes/changes";

/**
 * Sources of resources and their retirement (M10, ADR-021).
 * sourceRef formats: integration:<id> · integration-removed:<name> (backfill)
 * · collector:<agentId>:<platform> · agent:<agentId> · file:<format>.
 */
export type SourceKind = "integration" | "collector" | "agent" | "file";

export interface SourceView {
  ref: string;
  label: string;
  kind: SourceKind;
  /** The integration was deleted / the agent revoked or gone. Files are never "removed". */
  removed: boolean;
  total: number;
  stale: number;
  archived: number;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

function kindOf(ref: string): SourceKind {
  const prefix = ref.split(":")[0]!;
  if (prefix.startsWith("integration")) return "integration";
  return prefix as SourceKind;
}

/** Every source that created resources in the workspace, with counts. */
export async function listSources(ctx: WorkspaceContext): Promise<SourceView[]> {
  const db = tenantDb(ctx);
  const groups = await db.resource.groupBy({
    by: ["sourceRef", "sourceLabel", "status"],
    where: { workspaceId: ctx.workspaceId, sourceRef: { not: null } },
    _count: { _all: true },
  });
  const [integrations, agents] = await Promise.all([
    db.integration.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true } }),
    db.agent.findMany({
      where: { workspaceId: ctx.workspaceId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  const liveIntegrations = new Set(integrations.map((i) => i.id));
  const liveAgents = new Set(agents.map((a) => a.id));
  const byRef = new Map<string, SourceView>();
  for (const g of groups) {
    const ref = g.sourceRef!;
    const [prefix, id] = ref.split(":");
    const view = byRef.get(ref) ?? {
      ref,
      label: g.sourceLabel ?? ref,
      kind: kindOf(ref),
      removed:
        prefix === "integration-removed" ||
        (prefix === "integration" && !liveIntegrations.has(id!)) ||
        ((prefix === "agent" || prefix === "collector") && !liveAgents.has(id!)),
      total: 0,
      stale: 0,
      archived: 0,
    };
    view.total += g._count._all;
    if (g.status === "STALE") view.stale += g._count._all;
    if (g.status === "ARCHIVED") view.archived += g._count._all;
    byRef.set(ref, view);
  }
  return [...byRef.values()].sort(
    (a, b) => Number(b.removed) - Number(a.removed) || a.label.localeCompare(b.label),
  );
}

/**
 * Retires what a source created (MEMBER+). Untouched resources — no notes and
 * no change by a person mentioning them (edits, relationships, confirmations)
 * — are deleted; the rest are ARCHIVED (reversible). Live integrations and
 * agents keep their resources: remove the source first, or it would simply
 * re-create them on the next sync.
 */
export async function retireSource(
  ctx: WorkspaceContext,
  ref: string,
): Promise<{ deleted: number; archived: number }> {
  assertRole(ctx, "MEMBER");
  const source = (await listSources(ctx)).find((s) => s.ref === ref);
  if (!source) throw new SourceError("Nothing in this workspace came from that source.");
  if (!source.removed && source.kind !== "file")
    throw new SourceError(
      source.kind === "integration"
        ? "Delete the integration first (you can retire its resources in the same step)."
        : "Revoke the agent first, otherwise it reports these resources again.",
    );

  const db = tenantDb(ctx);
  const rows = await db.resource.findMany({
    where: { workspaceId: ctx.workspaceId, sourceRef: ref, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, status: true, notes: true },
  });
  if (rows.length === 0) return { deleted: 0, archived: 0 };
  const ids = rows.map((r) => r.id);
  const humanEvents = await db.changeEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      actorType: "USER",
      OR: [{ subjectId: { in: ids } }, { resourceIds: { hasSome: ids } }],
    },
    select: { subjectId: true, resourceIds: true },
  });
  const touched = new Set<string>();
  for (const e of humanEvents) for (const id of [e.subjectId, ...e.resourceIds]) touched.add(id);
  for (const r of rows) if (r.notes?.trim()) touched.add(r.id);

  let deleted = 0;
  let archived = 0;
  await db.$transaction(
    async (tx) => {
      for (const r of rows) {
        if (touched.has(r.id)) {
          await tx.resource.update({ where: { id: r.id }, data: { status: "ARCHIVED" } });
          await recordUserChange(tx, ctx, {
            subjectType: "RESOURCE",
            subjectId: r.id,
            subjectLabel: r.name,
            kind: "UPDATED",
            summary: `Archived ${r.name}: its source (${source.label}) was retired and it has human context`,
            diff: { status: [r.status, "ARCHIVED"] },
          });
          archived++;
        } else {
          await tx.resource.delete({ where: { id: r.id } });
          await recordUserChange(tx, ctx, {
            subjectType: "RESOURCE",
            subjectId: r.id,
            subjectLabel: r.name,
            kind: "DELETED",
            summary: `Retired ${r.name} (created by ${source.label}, never edited)`,
          });
          deleted++;
        }
      }
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        action: "workspace.source_retired",
        actor: userActor(ctx),
        target: { type: "source", id: ref, label: source.label },
        metadata: { deleted, archived },
      });
    },
    { timeout: 60_000 },
  );
  return { deleted, archived };
}
