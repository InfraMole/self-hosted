// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import {
  impactRanking,
  recoveryOrder,
  singlePointsOfFailure,
  type Confidence,
  type ImpactRank,
} from "@depmap/graph";
import { Environment } from "@/generated/prisma/enums";
import { viewSubset } from "@/lib/map-subset";
import { savedViewStateSchema } from "@/lib/map-view-state";
import { redundancyGroups } from "@/lib/redundancy";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { DEFAULT_IMPACT_DEPTH, toImpactEdges } from "@/server/modules/impact/impact";
import { getWorkspaceGraph, type MapNode } from "@/server/modules/map/map";

/**
 * Resilience report (M44, ADR-060): for every resource in scope, what it
 * could affect and what could affect it; single points of failure; the order
 * to bring things back. Computed on request from the workspace graph (no
 * cache, no schema): one impact per resource, ~1 s at 5,000 resources.
 */

/** Above this many resources in scope the page asks for a narrower scope. */
export const RESILIENCE_LIMIT = 5000;

/** Which relationships count, by confidence (the impact page counts all three). */
export const RESILIENCE_CONFIDENCE = {
  confirmed: ["confirmed"],
  detected: ["confirmed", "detected"],
  all: ["confirmed", "detected", "inferred"],
} as const satisfies Record<string, readonly Confidence[]>;
export type ResilienceConfidence = keyof typeof RESILIENCE_CONFIDENCE;

export const resilienceQuerySchema = z.object({
  environment: z.enum(Environment).optional(),
  /** A saved view: only the resources it shows. */
  view: z.string().min(1).max(64).optional(),
  confidence: z.enum(["confirmed", "detected", "all"]).default("detected"),
});
export type ResilienceQuery = z.input<typeof resilienceQuerySchema>;

export class ResilienceViewError extends Error {
  constructor() {
    super("That saved view no longer exists.");
    this.name = "ResilienceViewError";
  }
}

export interface ResilienceRow extends Omit<ImpactRank, "resourceId"> {
  resource: MapNode;
}

export interface ResilienceStep {
  resources: MapNode[];
  /** Members depend on each other in a circle: the order inside is unknown. */
  circular: boolean;
  /** The redundancy group's name when the step is one group. */
  groupName: string | null;
}

export interface Resilience {
  scope: {
    environment: Environment | null;
    view: { id: string; name: string } | null;
    confidence: ResilienceConfidence;
  };
  /** Resources in scope. */
  resources: number;
  /** Relationships between resources in scope (ignored ones excluded). */
  relationships: number;
  /** Of those, not reviewed yet: the numbers can change when they are. */
  unreviewed: number;
  /** More than RESILIENCE_LIMIT resources: nothing computed. */
  tooLarge: boolean;
  /** Every resource in scope, most impact first. */
  ranking: ResilienceRow[];
  /** Could affect something, no redundancy group — same order. */
  singlePoints: ResilienceRow[];
  recovery: { waves: ResilienceStep[][]; unconnected: MapNode[] };
}

export async function getResilience(ctx: WorkspaceContext, raw: unknown): Promise<Resilience> {
  const query = resilienceQuerySchema.parse(raw);
  const graph = await getWorkspaceGraph(ctx);

  let view: { id: string; name: string } | null = null;
  let nodes = graph.nodes;
  if (query.view) {
    const row = await tenantDb(ctx).savedView.findFirst({
      where: { id: query.view, workspaceId: ctx.workspaceId },
      select: { id: true, name: true, state: true },
    });
    const state = row && savedViewStateSchema.safeParse(row.state);
    if (!row || !state?.success) throw new ResilienceViewError();
    view = { id: row.id, name: row.name };
    nodes = viewSubset(graph.nodes, graph.edges, state.data).nodes;
  }
  if (query.environment) nodes = nodes.filter((n) => n.environment === query.environment);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const scope = { environment: query.environment ?? null, view, confidence: query.confidence };
  const base = {
    scope,
    resources: nodes.length,
    relationships: edges.length,
    unreviewed: edges.filter((e) => e.status === "UNCONFIRMED").length,
  };
  if (nodes.length > RESILIENCE_LIMIT)
    return {
      ...base,
      tooLarge: true,
      ranking: [],
      singlePoints: [],
      recovery: { waves: [], unconnected: [] },
    };

  const ids = nodes.map((n) => n.id);
  const impactEdges = toImpactEdges(edges);
  const groups = redundancyGroups(graph.nodes);
  const include = RESILIENCE_CONFIDENCE[query.confidence];
  const ranks = impactRanking(ids, impactEdges, {
    include,
    groups,
    maxDepth: DEFAULT_IMPACT_DEPTH,
  });
  const row = ({ resourceId, ...rest }: ImpactRank): ResilienceRow => ({
    resource: byId.get(resourceId)!,
    ...rest,
  });
  const order = recoveryOrder(ids, impactEdges, { include, groups });
  const node = (id: string) => byId.get(id)!;
  const byName = (a: MapNode, b: MapNode) => a.name.localeCompare(b.name);
  return {
    ...base,
    tooLarge: false,
    ranking: ranks.map(row),
    singlePoints: singlePointsOfFailure(ranks, groups).map(row),
    recovery: {
      waves: order.waves.map((wave) =>
        wave
          .map((step) => ({
            resources: step.ids.map(node).sort(byName),
            circular: step.circular,
            groupName: step.group
              ? (step.ids.map((id) => byId.get(id)?.redundancyGroup).find(Boolean) ?? step.group)
              : null,
          }))
          .sort((a, b) => byName(a.resources[0]!, b.resources[0]!)),
      ),
      unconnected: order.unconnected.map(node).sort(byName),
    },
  };
}

/**
 * "Could affect" of some resources over the whole workspace graph (the
 * Library column, M44): one impact per given resource, not per workspace.
 */
export async function couldAffectOf(
  ctx: WorkspaceContext,
  resourceIds: readonly string[],
): Promise<Map<string, number>> {
  if (resourceIds.length === 0) return new Map();
  const graph = await getWorkspaceGraph(ctx);
  const ranks = impactRanking(
    graph.nodes.map((n) => n.id),
    toImpactEdges(graph.edges),
    {
      roots: resourceIds,
      groups: redundancyGroups(graph.nodes),
      maxDepth: DEFAULT_IMPACT_DEPTH,
    },
  );
  return new Map(ranks.map((r) => [r.resourceId, r.couldAffect]));
}
