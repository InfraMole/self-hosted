// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { assertCanAddMember } from "@/server/modules/billing/limits";
import { isDemoUser } from "@/server/modules/demo/demo";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { z } from "zod";
import {
  ForbiddenError,
  assertRole,
  hasRole,
  type Role,
  type WorkspaceContext,
} from "@/server/authz";
import { systemDb, tenantDb } from "@/server/db";
import { generateSecret, hashSecret, isWellFormed } from "@/server/modules/agents/secrets";

/**
 * Members & invitations (M8b). Rules:
 * - ADMIN+ invites, changes roles and removes members; anyone can leave.
 * - Only an OWNER can grant, change or remove the OWNER role.
 * - A workspace always keeps at least one OWNER.
 * - Invitation tokens are shown once, stored as sha256, expire after 7 days,
 *   and can only be accepted by a signed-in user with the invited email.
 */

export const INVITATION_TTL_DAYS = 7;
export const MAX_PENDING_INVITATIONS = 50;

export class MemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberError";
  }
}

export const invitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  role: z.enum(["VIEWER", "MEMBER", "ADMIN", "OWNER"]),
});
export type InvitationInput = z.input<typeof invitationInputSchema>;

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  state: InvitationState;
  expiresAt: Date;
  createdAt: Date;
  invitedByName: string;
}

function stateOf(
  i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
): InvitationState {
  if (i.acceptedAt) return "accepted";
  if (i.revokedAt) return "revoked";
  if (i.expiresAt <= now) return "expired";
  return "pending";
}

/** Only an OWNER may touch the OWNER role (granting or holding). */
function assertCanAssign(ctx: WorkspaceContext, role: Role) {
  assertRole(ctx, "ADMIN");
  if (role === "OWNER" && ctx.role !== "OWNER")
    throw new ForbiddenError("Only an owner can grant the owner role.");
}

// ───────────────────────── Members ─────────────────────────

/** Any member can see who else is in the workspace. */
export async function listMembers(ctx: WorkspaceContext): Promise<MemberView[]> {
  const rows = await tenantDb(ctx).membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    joinedAt: m.createdAt,
  }));
}

async function ownerCount(
  tx: Pick<ReturnType<typeof tenantDb>, "membership">,
  workspaceId: string,
) {
  return tx.membership.count({ where: { workspaceId, role: "OWNER" } });
}

export async function changeMemberRole(
  ctx: WorkspaceContext,
  userId: string,
  role: Role,
): Promise<void> {
  const next = z.enum(["VIEWER", "MEMBER", "ADMIN", "OWNER"]).parse(role);
  assertCanAssign(ctx, next);
  await tenantDb(ctx).$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } },
      include: { user: { select: { email: true } } },
    });
    if (!target) throw new MemberError("Member not found.");
    if (target.role === next) return;
    if (target.role === "OWNER") {
      if (ctx.role !== "OWNER")
        throw new ForbiddenError("Only an owner can change another owner's role.");
      if ((await ownerCount(tx, ctx.workspaceId)) <= 1)
        throw new MemberError(
          "A workspace needs at least one owner. Make someone else owner first.",
        );
    }
    await tx.membership.update({ where: { id: target.id }, data: { role: next } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "member.role_changed",
      actor: userActor(ctx),
      target: { type: "user", id: userId, label: target.user.email },
      metadata: { from: target.role, to: next },
    });
  });
}

/** ADMIN+ removes others; anyone may remove themselves (leave). */
export async function removeMember(ctx: WorkspaceContext, userId: string): Promise<void> {
  const self = userId === ctx.userId;
  if (!self) assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const target = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } },
      include: { user: { select: { email: true } } },
    });
    if (!target) throw new MemberError("Member not found.");
    // The shared demo account (M13) stays in the demo workspace.
    if (isDemoUser(target.user))
      throw new MemberError("The demo account cannot leave or be removed from the demo.");
    if (target.role === "OWNER") {
      if (!self && ctx.role !== "OWNER")
        throw new ForbiddenError("Only an owner can remove an owner.");
      if ((await ownerCount(tx, ctx.workspaceId)) <= 1)
        throw new MemberError(
          "A workspace needs at least one owner. Make someone else owner first.",
        );
    }
    await tx.membership.delete({ where: { id: target.id } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: self ? "member.left" : "member.removed",
      actor: userActor(ctx),
      target: { type: "user", id: userId, label: target.user.email },
      metadata: { role: target.role },
    });
  });
}

// ───────────────────────── Invitations ─────────────────────────

export async function listInvitations(ctx: WorkspaceContext): Promise<InvitationView[]> {
  assertRole(ctx, "ADMIN");
  const rows = await tenantDb(ctx).invitation.findMany({
    where: { workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    state: stateOf(r),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    invitedByName: r.invitedBy.name,
  }));
}

/** Returns the plaintext token exactly once. Re-inviting an email replaces its pending invitation. */
export async function createInvitation(
  ctx: WorkspaceContext,
  input: InvitationInput,
): Promise<{ id: string; token: string; email: string; role: Role }> {
  const { email, role } = invitationInputSchema.parse(input);
  assertCanAssign(ctx, role);
  const db = tenantDb(ctx);
  const existingMember = await db.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, user: { email } },
    select: { id: true },
  });
  if (existingMember) throw new MemberError("That person is already a member of this workspace.");

  const now = new Date();
  // Plan seats (ADR-023): members + pending invitations to other addresses.
  const [members, otherPending] = await Promise.all([
    db.membership.count({ where: { workspaceId: ctx.workspaceId } }),
    db.invitation.count({
      where: {
        workspaceId: ctx.workspaceId,
        email: { not: email },
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    }),
  ]);
  await assertCanAddMember(ctx.workspaceId, members + otherPending);
  const secret = generateSecret("invitation");
  const created = await db.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { workspaceId: ctx.workspaceId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const pending = await tx.invitation.count({
      where: {
        workspaceId: ctx.workspaceId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (pending >= MAX_PENDING_INVITATIONS)
      throw new MemberError(
        `Too many pending invitations (max ${MAX_PENDING_INVITATIONS}). Revoke some first.`,
      );
    const invitation = await tx.invitation.create({
      data: {
        workspaceId: ctx.workspaceId,
        email,
        role,
        tokenHash: secret.hash,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000),
        invitedById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "member.invited",
      actor: userActor(ctx),
      target: { type: "invitation", id: invitation.id, label: email },
      metadata: { role },
    });
    return invitation;
  });
  return { id: created.id, token: secret.value, email, role };
}

export async function revokeInvitation(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({
      where: { id, workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!inv) throw new MemberError("Invitation not found.");
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "member.invitation_revoked",
      actor: userActor(ctx),
      target: { type: "invitation", id: inv.id, label: inv.email },
      metadata: { role: inv.role },
    });
  });
}

export interface InvitationPreview {
  state: InvitationState;
  workspaceName: string;
  workspaceSlug: string;
  role: Role;
  /** Masked (j***@corp.com): the link may have been forwarded. */
  emailHint: string;
  invitedByName: string;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function findByToken(token: string) {
  if (!isWellFormed(token, "invitation")) return null;
  // The token is the only key: the workspace is unknown until it is found.
  return systemDb("invitation lookup by token hash").invitation.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: {
      workspace: { select: { name: true, slug: true } },
      invitedBy: { select: { name: true } },
    },
  });
}

/** For the /invite page. null = unknown token (never distinguish further). */
export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  const inv = await findByToken(token);
  if (!inv) return null;
  return {
    state: stateOf(inv),
    workspaceName: inv.workspace.name,
    workspaceSlug: inv.workspace.slug,
    role: inv.role,
    emailHint: maskEmail(inv.email),
    invitedByName: inv.invitedBy.name,
  };
}

/** Accepts for the signed-in user; returns the workspace slug. */
export async function acceptInvitation(
  user: { id: string; email: string; emailVerified?: boolean },
  token: string,
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<{ slug: string }> {
  const inv = await findByToken(token);
  if (!inv) throw new MemberError("This invitation link is not valid.");
  const state = stateOf(inv);
  if (state === "accepted") {
    // Idempotent for the person who accepted it.
    if (inv.acceptedById === user.id) return { slug: inv.workspace.slug };
    throw new MemberError("This invitation has already been used.");
  }
  if (state === "revoked") throw new MemberError("This invitation was revoked. Ask for a new one.");
  if (state === "expired") throw new MemberError("This invitation has expired. Ask for a new one.");
  if (user.email.toLowerCase() !== inv.email)
    throw new MemberError(
      `This invitation is for ${maskEmail(inv.email)}. Sign in with that email address to accept it.`,
    );
  // The invitation is bound to the email: prove it when a mailer can.
  if (options.requireVerifiedEmail && !user.emailVerified)
    throw new MemberError("Verify your email address first (check your inbox), then accept.");

  await tenantDb({ workspaceId: inv.workspaceId, userId: user.id }).$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    });
    if (count === 0) throw new MemberError("This invitation has already been used.");
    const existing = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } },
    });
    if (!existing) {
      await tx.membership.create({
        data: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role },
      });
    } else if (hasRole(inv.role, existing.role) && inv.role !== existing.role) {
      // Never downgrade someone through an invitation; upgrade if it grants more.
      await tx.membership.update({ where: { id: existing.id }, data: { role: inv.role } });
    }
    await recordAudit(tx, {
      workspaceId: inv.workspaceId,
      action: "member.joined",
      actor: { type: "USER", id: user.id, label: user.email },
      target: { type: "invitation", id: inv.id, label: inv.email },
      metadata: { role: inv.role, invitedBy: inv.invitedBy.name },
    });
  });
  return { slug: inv.workspace.slug };
}
