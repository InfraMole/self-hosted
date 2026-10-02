// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { dependencyDirection, edgeConfidence, impact } from "@depmap/graph";
import type { FirstStepsFacts } from "@/lib/first-steps";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";

/**
 * What the first-steps checklist (M28) knows from the data: is there
 * infrastructure, is anything confirmed, and which resource makes the best
 * first impact question — the one with the most that could be affected.
 * The "opened the map / asked about impact" steps are per-viewer and live in
 * the browser (lib/first-steps.ts).
 */
export async function getFirstStepsFacts(ctx: WorkspaceContext): Promise<FirstStepsFacts> {
  const db = tenantDb(ctx);
  const where = { workspaceId: ctx.workspaceId };
  const [resources, pendingSuggestions, confirmed] = await Promise.all([
    db.resource.count({ where: { ...where, status: { not: "ARCHIVED" } } }),
    db.relationship.count({ where: { ...where, status: "UNCONFIRMED" } }),
    db.relationship.count({ where: { ...where, status: "CONFIRMED" } }),
  ]);
  return {
    resources,
    pendingSuggestions,
    confirmedRelationships: confirmed,
    showcase: confirmed > 0 ? await showcase(ctx) : null,
  };
}

/** Bounded: the 25 resources with the most direct dependents are compared. */
async function showcase(ctx: WorkspaceContext): Promise<FirstStepsFacts["showcase"]> {
  const db = tenantDb(ctx);
  const rows = await db.relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: { not: "IGNORED" },
      from: { status: { not: "ARCHIVED" } },
      to: { status: { not: "ARCHIVED" } },
    },
    select: {
      id: true,
      fromResourceId: true,
      toResourceId: true,
      type: true,
      status: true,
      origin: true,
    },
    take: 20_000,
  });
  const edges = rows.map((r) => ({
    id: r.id,
    from: r.fromResourceId,
    to: r.toResourceId,
    type: r.type,
    confidence: edgeConfidence(r.status, r.origin),
  }));
  const dependents = new Map<string, number>();
  for (const e of edges) {
    const d = dependencyDirection(e);
    if (d) dependents.set(d.dependency, (dependents.get(d.dependency) ?? 0) + 1);
  }
  const candidates = [...dependents.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([id]) => id);
  let best: { id: string; affected: number } | null = null;
  for (const id of candidates) {
    const affected = impact(edges, id).affected.length;
    if (!best || affected > best.affected) best = { id, affected };
  }
  if (!best || best.affected === 0) return null;
  const resource = await db.resource.findFirst({
    where: { id: best.id, workspaceId: ctx.workspaceId },
    select: { name: true },
  });
  return resource ? { id: best.id, name: resource.name, affected: best.affected } : null;
}
