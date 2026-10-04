// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import { sanitizeViewState, savedViewStateSchema, type SavedViewState } from "@/lib/map-view-state";
import { viewSubset } from "@/lib/map-subset";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { systemDb, tenantDb } from "@/server/db";
import { generateSecret, hashSecret, isWellFormed } from "@/server/modules/agents/secrets";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { getWorkspaceGraph, type MapEdge, type MapNode } from "./map";

/**
 * Public read-only links to a saved view (M31, ADR-045). Anyone with the URL
 * sees what the view shows — names, types, environments and how they are
 * linked — never IP addresses, owners, contacts or relationship notes.
 * ADMIN+ create and revoke them (they publish data outside the workspace).
 */
export const SHARES_LIMIT = 25;
/** Days; 0 = never expires. */
export const SHARE_EXPIRY_DAYS = [7, 30, 90, 0] as const;

export const createShareSchema = z.object({
  viewId: z.string().min(1).max(64),
  expiresInDays: z.coerce
    .number()
    .refine((d) => (SHARE_EXPIRY_DAYS as readonly number[]).includes(d), "Invalid expiry"),
});

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareError";
  }
}

export type ShareState = "active" | "expired" | "revoked";

export interface ShareView {
  id: string;
  viewId: string;
  viewName: string;
  prefix: string;
  expiresAt: Date | null;
  lastViewedAt: Date | null;
  createdAt: Date;
  state: ShareState;
}

/** Returns the token ONCE (the URL is /share/<token>); only its hash is stored. */
export async function createShare(ctx: WorkspaceContext, rawInput: unknown) {
  assertRole(ctx, "ADMIN");
  const input = createShareSchema.parse(rawInput);
  const secret = generateSecret("share");
  const created = await tenantDb(ctx).$transaction(async (tx) => {
    const view = await tx.savedView.findFirst({
      where: { id: input.viewId, workspaceId: ctx.workspaceId },
      select: { id: true, name: true },
    });
    if (!view) throw new ShareError("This view no longer exists.");
    const active = await tx.mapShare.count({
      where: {
        workspaceId: ctx.workspaceId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (active >= SHARES_LIMIT)
      throw new ShareError(
        `A workspace can have up to ${SHARES_LIMIT} public links. Revoke one first.`,
      );
    const share = await tx.mapShare.create({
      data: {
        workspaceId: ctx.workspaceId,
        savedViewId: view.id,
        tokenHash: secret.hash,
        prefix: secret.displayPrefix,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
        createdById: ctx.userId,
      },
      select: { id: true, expiresAt: true },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "share.created",
      actor: userActor(ctx),
      target: { type: "map_share", id: share.id, label: view.name },
      metadata: { prefix: secret.displayPrefix, expiresInDays: input.expiresInDays || null },
    });
    return share;
  });
  return { ...created, token: secret.value };
}

export async function listShares(ctx: WorkspaceContext): Promise<ShareView[]> {
  assertRole(ctx, "ADMIN");
  const now = Date.now();
  const rows = await tenantDb(ctx).mapShare.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      prefix: true,
      expiresAt: true,
      lastViewedAt: true,
      createdAt: true,
      revokedAt: true,
      savedView: { select: { id: true, name: true } },
    },
  });
  return rows.map(({ revokedAt, savedView, ...s }) => ({
    ...s,
    viewId: savedView.id,
    viewName: savedView.name,
    state: revokedAt
      ? "revoked"
      : s.expiresAt && s.expiresAt.getTime() <= now
        ? "expired"
        : "active",
  }));
}

export async function revokeShare(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const share = await tx.mapShare.findFirst({
      where: { id, workspaceId: ctx.workspaceId, revokedAt: null },
      select: { id: true, savedView: { select: { name: true } } },
    });
    if (!share) throw new ShareError("Link not found or already revoked");
    await tx.mapShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "share.revoked",
      actor: userActor(ctx),
      target: { type: "map_share", id: share.id, label: share.savedView.name },
    });
  });
}

export interface SharedMap {
  viewName: string;
  workspaceName: string;
  nodes: MapNode[];
  edges: MapEdge[];
  state: SavedViewState;
}

const VIEWED_EVERY_MS = 5 * 60_000;

/**
 * What a public link shows, or null (malformed, unknown, revoked, expired,
 * view gone). The link is found by hash across workspaces — the only
 * cross-tenant step; the graph is then read scoped to its workspace, the
 * view applied, and personal / network details removed.
 */
export async function resolveShare(token: string, now = new Date()): Promise<SharedMap | null> {
  if (!isWellFormed(token, "share")) return null;
  const share = await systemDb("public map link by token hash").mapShare.findUnique({
    where: { tokenHash: hashSecret(token) },
    select: {
      id: true,
      workspaceId: true,
      expiresAt: true,
      revokedAt: true,
      lastViewedAt: true,
      savedView: { select: { name: true, state: true } },
      workspace: { select: { slug: true, name: true } },
    },
  });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= now)) return null;
  const parsed = savedViewStateSchema.safeParse(share.savedView.state);
  if (!parsed.success) return null;

  const ctx: WorkspaceContext = {
    workspaceId: share.workspaceId,
    workspaceSlug: share.workspace.slug,
    workspaceName: share.workspace.name,
    userId: `share_${share.id}`,
    role: "VIEWER",
  };
  if (!share.lastViewedAt || now.getTime() - share.lastViewedAt.getTime() > VIEWED_EVERY_MS)
    await tenantDb(ctx).mapShare.update({
      where: { id: share.id },
      data: { lastViewedAt: now },
    });

  const graph = await getWorkspaceGraph(ctx);
  const subset = viewSubset(graph.nodes, graph.edges, parsed.data);
  const ids = new Set(subset.nodes.map((n) => n.id));
  return {
    viewName: share.savedView.name,
    workspaceName: share.workspace.name,
    nodes: subset.nodes.map((n) => ({ ...n, ipAddresses: [], owner: null, ownerContact: null })),
    edges: subset.edges.map((e) => ({ ...e, note: null })),
    state: sanitizeViewState(parsed.data, (id) => ids.has(id)),
  };
}
