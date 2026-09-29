// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { z } from "zod";
import type { AgentStatus } from "@/generated/prisma/enums";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { generateSecret } from "./secrets";

// ───────────────────────── Enrollment tokens (ADMIN+) ─────────────────────────

export const TOKEN_EXPIRY_HOURS = [1, 24, 24 * 7, 24 * 30] as const;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64),
  expiresInHours: z.coerce
    .number()
    .refine((h) => (TOKEN_EXPIRY_HOURS as readonly number[]).includes(h), "Invalid expiry"),
  maxUses: z.coerce.number().int().min(1).max(1000).nullable().default(null),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;

export class AgentNotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "AgentNotFoundError";
  }
}

/** Returns the plaintext token ONCE; only its hash is stored. */
export async function createEnrollmentToken(ctx: WorkspaceContext, rawInput: unknown) {
  assertRole(ctx, "ADMIN");
  const input = createTokenSchema.parse(rawInput);
  const secret = generateSecret("enrollment");
  const token = await tenantDb(ctx).$transaction(async (tx) => {
    const created = await tx.enrollmentToken.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        tokenHash: secret.hash,
        prefix: secret.displayPrefix,
        expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000),
        maxUses: input.maxUses,
        createdById: ctx.userId,
      },
      select: { id: true, name: true, expiresAt: true },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "agent.token_created",
      actor: userActor(ctx),
      target: { type: "enrollment_token", id: created.id, label: created.name },
      metadata: { prefix: secret.displayPrefix, expiresInHours: input.expiresInHours },
    });
    return created;
  });
  return { ...token, token: secret.value };
}

export type TokenState = "active" | "expired" | "revoked" | "exhausted";

export interface EnrollmentTokenView {
  id: string;
  name: string;
  prefix: string;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  createdAt: Date;
  state: TokenState;
}

export async function listEnrollmentTokens(ctx: WorkspaceContext): Promise<EnrollmentTokenView[]> {
  assertRole(ctx, "ADMIN");
  const now = Date.now();
  const tokens = await tenantDb(ctx).enrollmentToken.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      prefix: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  return tokens.map(({ revokedAt, ...t }) => ({
    ...t,
    state: revokedAt
      ? "revoked"
      : t.expiresAt.getTime() <= now
        ? "expired"
        : t.maxUses !== null && t.useCount >= t.maxUses
          ? "exhausted"
          : "active",
  }));
}

export async function revokeEnrollmentToken(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const token = await tx.enrollmentToken.findFirst({
      where: { id, workspaceId: ctx.workspaceId, revokedAt: null },
      select: { id: true, name: true },
    });
    if (!token) throw new AgentNotFoundError("Token not found or already revoked");
    await tx.enrollmentToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "agent.token_revoked",
      actor: userActor(ctx),
      target: { type: "enrollment_token", id: token.id, label: token.name },
    });
  });
}

// ───────────────────────── Agents ─────────────────────────

export interface AgentView {
  id: string;
  hostname: string;
  os: string;
  osVersion: string;
  arch: string;
  agentVersion: string;
  status: AgentStatus;
  reportIntervalSec: number;
  lastSeenAt: Date | null;
  lastIp: string | null;
  enrolledAt: Date;
  resourceId: string | null;
  secretPrefix: string;
}

/** Agents of the workspace (any member may see them). */
export async function listAgents(ctx: WorkspaceContext): Promise<AgentView[]> {
  return tenantDb(ctx).agent.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ status: "asc" }, { hostname: "asc" }],
    select: {
      id: true,
      hostname: true,
      os: true,
      osVersion: true,
      arch: true,
      agentVersion: true,
      status: true,
      reportIntervalSec: true,
      lastSeenAt: true,
      lastIp: true,
      enrolledAt: true,
      resourceId: true,
      secretPrefix: true,
    },
  });
}

/** Revoked agents get 401 on their next report. Their host resource is kept. */
export async function revokeAgent(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const agent = await tx.agent.findFirst({
      where: { id, workspaceId: ctx.workspaceId, status: "ACTIVE" },
      select: { id: true, hostname: true },
    });
    if (!agent) throw new AgentNotFoundError("Agent not found or already revoked");
    await tx.agent.update({
      where: { id: agent.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "agent.revoked",
      actor: userActor(ctx),
      target: { type: "agent", id: agent.id, label: agent.hostname },
    });
  });
}

/** "reporting" if seen within 3 report intervals (docs/DISCOVERY.md §3). */
export function agentHealth(
  agent: Pick<AgentView, "status" | "lastSeenAt" | "reportIntervalSec">,
  now = Date.now(),
) {
  if (agent.status === "REVOKED") return "revoked" as const;
  if (!agent.lastSeenAt) return "pending" as const;
  return now - agent.lastSeenAt.getTime() <= agent.reportIntervalSec * 3 * 1000
    ? ("reporting" as const)
    : ("silent" as const);
}
