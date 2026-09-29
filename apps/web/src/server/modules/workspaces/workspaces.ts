// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { isValidSlug, workspaceSlugBase } from "@/lib/slug";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb, userDb } from "@/server/db";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { CLOUD_TRIAL_DAYS } from "@/lib/billing-plans";
import { getEnv } from "@/server/env";

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(64, "Max 64 characters"),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceContext["role"];
}

const MAX_SLUG_ATTEMPTS = 5;
/** Abuse guard: workspaces a single user may own. */
export const MAX_OWNED_WORKSPACES = 20;

export class WorkspaceLimitError extends Error {
  constructor() {
    super(`You can own at most ${MAX_OWNED_WORKSPACES} workspaces.`);
    this.name = "WorkspaceLimitError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Creates a workspace and makes `userId` its OWNER, atomically.
 * Slug collisions are resolved with a random suffix.
 */
export async function createWorkspace(
  userId: string,
  input: CreateWorkspaceInput,
): Promise<WorkspaceSummary> {
  const { name } = createWorkspaceInput.parse(input);
  const base = workspaceSlugBase(name);

  const owned = await userDb(userId).membership.count({ where: { userId, role: "OWNER" } });
  if (owned >= MAX_OWNED_WORKSPACES) throw new WorkspaceLimitError();

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 41)}-${randomBytes(3).toString("hex")}`;
    try {
      // The id is chosen up front so the insert runs in its own tenant scope (RLS).
      const id = randomUUID();
      // Cloud: every new workspace starts with the free Team trial (ADR-023).
      const trialEndsAt =
        getEnv().EDITION === "cloud" ? new Date(Date.now() + CLOUD_TRIAL_DAYS * 86_400_000) : null;
      const workspace = await tenantDb({ workspaceId: id, userId }).workspace.create({
        data: { id, name, slug, trialEndsAt, memberships: { create: { userId, role: "OWNER" } } },
      });
      await recordAudit(tenantDb({ workspaceId: workspace.id, userId }), {
        workspaceId: workspace.id,
        action: "workspace.created",
        actor: { type: "USER", id: userId },
        target: { type: "workspace", id: workspace.id, label: workspace.name },
      });
      return { id: workspace.id, name: workspace.name, slug: workspace.slug, role: "OWNER" };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not allocate a unique workspace slug");
}

/** Workspaces the user is a member of, oldest first. */
export async function listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await userDb(userId).membership.findMany({
    where: { userId },
    include: {
      workspace: { select: { id: true, name: true, slug: true, requireTwoFactor: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

/**
 * The only way to obtain a WorkspaceContext for a user: via Membership.
 * Returns null when the workspace does not exist OR the user is not a member
 * (callers must not distinguish the two).
 */
export async function findWorkspaceContextForUser(
  userId: string,
  slug: string,
): Promise<WorkspaceContext | null> {
  if (!isValidSlug(slug)) return null;
  const membership = await userDb(userId).membership.findFirst({
    where: { userId, workspace: { slug } },
    include: {
      workspace: { select: { id: true, name: true, slug: true, requireTwoFactor: true } },
    },
  });
  if (!membership) return null;
  return {
    workspaceId: membership.workspace.id,
    workspaceSlug: membership.workspace.slug,
    workspaceName: membership.workspace.name,
    userId,
    role: membership.role,
    requireTwoFactor: membership.workspace.requireTwoFactor,
  };
}

/**
 * OWNER only. Turning the policy on requires the owner to have 2FA already,
 * so nobody locks the last owner out.
 */
export async function setRequireTwoFactor(ctx: WorkspaceContext, value: boolean): Promise<void> {
  assertRole(ctx, "OWNER");
  await tenantDb(ctx).$transaction(async (tx) => {
    if (value) {
      const me = await tx.user.findUnique({
        where: { id: ctx.userId },
        select: { twoFactorEnabled: true },
      });
      if (!me?.twoFactorEnabled)
        throw new WorkspaceSettingsError(
          "Enable two-factor authentication on your own account first.",
        );
    }
    await tx.workspace.update({
      where: { id: ctx.workspaceId },
      data: { requireTwoFactor: value },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "workspace.settings_changed",
      actor: userActor(ctx),
      target: { type: "workspace", id: ctx.workspaceId, label: ctx.workspaceName },
      metadata: { requireTwoFactor: value },
    });
  });
}

export class WorkspaceSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSettingsError";
  }
}

export class WorkspaceDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDeleteError";
  }
}

/**
 * OWNER only, confirmed by typing the exact workspace name. Deletes the
 * workspace and **everything in it** (cascade: resources, relationships,
 * agents, observations, facts, integrations and their sealed secrets,
 * invitations, changes, audit events). The only trace left is an
 * account-level audit event with counts (no content).
 */
export async function deleteWorkspace(ctx: WorkspaceContext, confirmName: string): Promise<void> {
  assertRole(ctx, "OWNER");
  if (confirmName.trim() !== ctx.workspaceName)
    throw new WorkspaceDeleteError("Type the exact workspace name to confirm.");
  const where = { workspaceId: ctx.workspaceId };
  await tenantDb(ctx).$transaction(async (tx) => {
    // Lets the cascade remove this workspace's audit rows (append-only trigger).
    await tx.$executeRaw`SELECT set_config('depmap.allow_audit_delete', 'on', true)`;
    const [resources, agents, integrations, members] = await Promise.all([
      tx.resource.count({ where }),
      tx.agent.count({ where }),
      tx.integration.count({ where }),
      tx.membership.count({ where }),
    ]);
    await tx.workspace.delete({ where: { id: ctx.workspaceId } });
    await recordAudit(tx, {
      workspaceId: null,
      action: "workspace.deleted",
      actor: userActor(ctx),
      target: { type: "workspace", id: ctx.workspaceId, label: ctx.workspaceName },
      metadata: { resources, agents, integrations, members },
    });
  });
}
