// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import type { WorkspaceContext } from "@/server/authz";
import { assertRole } from "@/server/authz";
import { systemDb, tenantDb } from "@/server/db";
import { generateSecret, hashSecret } from "@/server/modules/agents/secrets";
import { recordAudit, userActor } from "@/server/modules/audit/audit";

/**
 * Read-only API tokens (M30, ADR-044). A token reads one workspace with
 * VIEWER rights through /api/v1 and can never write. Managed by admins;
 * shown once, stored as sha256, revocable, audited.
 */
export const API_TOKENS_LIMIT = 25;
/** Days; 0 = never expires. */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365, 0] as const;

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64, "Up to 64 characters"),
  expiresInDays: z.coerce
    .number()
    .refine((d) => (API_TOKEN_EXPIRY_DAYS as readonly number[]).includes(d), "Invalid expiry"),
});

export class ApiTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiTokenError";
  }
}

export type ApiTokenState = "active" | "expired" | "revoked";

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  state: ApiTokenState;
}

/** Returns the plaintext token ONCE; only its hash is stored. */
export async function createApiToken(ctx: WorkspaceContext, rawInput: unknown) {
  assertRole(ctx, "ADMIN");
  const input = createApiTokenSchema.parse(rawInput);
  const secret = generateSecret("api");
  const created = await tenantDb(ctx).$transaction(async (tx) => {
    const active = await tx.apiToken.count({
      where: { workspaceId: ctx.workspaceId, revokedAt: null },
    });
    if (active >= API_TOKENS_LIMIT)
      throw new ApiTokenError(
        `A workspace can have up to ${API_TOKENS_LIMIT} API tokens. Revoke one first.`,
      );
    const token = await tx.apiToken.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        tokenHash: secret.hash,
        prefix: secret.displayPrefix,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
        createdById: ctx.userId,
      },
      select: { id: true, name: true, expiresAt: true },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "api.token_created",
      actor: userActor(ctx),
      target: { type: "api_token", id: token.id, label: token.name },
      metadata: { prefix: secret.displayPrefix, expiresInDays: input.expiresInDays || null },
    });
    return token;
  });
  return { ...created, token: secret.value };
}

export async function listApiTokens(ctx: WorkspaceContext): Promise<ApiTokenView[]> {
  assertRole(ctx, "ADMIN");
  const now = Date.now();
  const rows = await tenantDb(ctx).apiToken.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      prefix: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  return rows.map(({ revokedAt, ...t }) => ({
    ...t,
    state: revokedAt
      ? "revoked"
      : t.expiresAt && t.expiresAt.getTime() <= now
        ? "expired"
        : "active",
  }));
}

export async function revokeApiToken(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const token = await tx.apiToken.findFirst({
      where: { id, workspaceId: ctx.workspaceId, revokedAt: null },
      select: { id: true, name: true },
    });
    if (!token) throw new ApiTokenError("Token not found or already revoked");
    await tx.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "api.token_revoked",
      actor: userActor(ctx),
      target: { type: "api_token", id: token.id, label: token.name },
    });
  });
}

/** How often `lastUsedAt` is written (not on every request). */
const LAST_USED_EVERY_MS = 5 * 60_000;

/**
 * Resolves a token to a read-only workspace context, or null (unknown,
 * revoked, expired). The token is found by hash across workspaces — the
 * only cross-tenant step, like agent authentication; everything after it
 * runs scoped to the token's workspace.
 */
export async function authenticateApiToken(
  secret: string,
  now = new Date(),
): Promise<WorkspaceContext | null> {
  const token = await systemDb("API authentication by token hash").apiToken.findUnique({
    where: { tokenHash: hashSecret(secret) },
    select: {
      id: true,
      workspaceId: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      workspace: { select: { slug: true, name: true } },
    },
  });
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= now)) return null;
  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > LAST_USED_EVERY_MS)
    await tenantDb({ workspaceId: token.workspaceId }).apiToken.update({
      where: { id: token.id },
      data: { lastUsedAt: now },
    });
  return {
    workspaceId: token.workspaceId,
    workspaceSlug: token.workspace.slug,
    workspaceName: token.workspace.name,
    // Not a user: reads never record an actor, and VIEWER cannot write.
    userId: `api_${token.id}`,
    role: "VIEWER",
  };
}
