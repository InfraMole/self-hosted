// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { tenantDb, userDb } from "@/server/db";
import { recordAudit } from "@/server/modules/audit/audit";
import { deleteWorkspace } from "@/server/modules/workspaces/workspaces";

/**
 * Account security (M8c). 2FA and passkey registration run through Better
 * Auth's client endpoints; these helpers read the resulting state from the
 * database and keep the account-level audit trail in step with it, so a
 * client can never record an event that did not happen.
 */

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

export interface AccountSecurity {
  twoFactorEnabled: boolean;
  /** "credential" (email + password), "google", "microsoft". */
  signInMethods: { providerId: string; createdAt: Date }[];
  passkeys: { id: string; name: string | null; createdAt: Date | null; deviceType: string }[];
}

export async function getAccountSecurity(userId: string): Promise<AccountSecurity> {
  const user = await userDb(userId).user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      twoFactorEnabled: true,
      accounts: { select: { providerId: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      passkeys: {
        select: { id: true, name: true, createdAt: true, deviceType: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const { accounts, ...rest } = user;
  return { ...rest, signInMethods: accounts };
}

const TWO_FACTOR_ACTIONS = ["auth.two_factor_enabled", "auth.two_factor_disabled"];

/** Records enable/disable if the stored state differs from the last recorded one. */
export async function syncTwoFactorAudit(userId: string): Promise<void> {
  const db = userDb(userId);
  const [user, last] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorEnabled: true, email: true },
    }),
    db.auditEvent.findFirst({
      where: { workspaceId: null, actorId: userId, action: { in: TWO_FACTOR_ACTIONS } },
      orderBy: { createdAt: "desc" },
      select: { action: true },
    }),
  ]);
  const recordedOn = last?.action === "auth.two_factor_enabled";
  if (user.twoFactorEnabled === recordedOn) return;
  await recordAudit(db, {
    workspaceId: null,
    action: user.twoFactorEnabled ? "auth.two_factor_enabled" : "auth.two_factor_disabled",
    actor: { type: "USER", id: userId, label: user.email },
  });
}

/** Records every passkey registered after the last recorded one. */
export async function syncPasskeyAudit(userId: string): Promise<void> {
  const db = userDb(userId);
  const last = await db.auditEvent.findFirst({
    where: { workspaceId: null, actorId: userId, action: "auth.passkey_added" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const fresh = await db.passkey.findMany({
    where: { userId, ...(last ? { createdAt: { gt: last.createdAt } } : {}) },
    select: { id: true, name: true },
  });
  for (const p of fresh)
    await recordAudit(db, {
      workspaceId: null,
      action: "auth.passkey_added",
      actor: { type: "USER", id: userId },
      target: { type: "passkey", id: p.id, label: p.name ?? "passkey" },
    });
}

/** Deletes one of the user's own passkeys (never another user's). */
export async function removePasskey(userId: string, id: string): Promise<void> {
  await userDb(userId).$transaction(async (tx) => {
    const key = await tx.passkey.findFirst({
      where: { id, userId },
      select: { id: true, name: true },
    });
    if (!key) throw new AccountError("Passkey not found.");
    await tx.passkey.delete({ where: { id: key.id } });
    await recordAudit(tx, {
      workspaceId: null,
      action: "auth.passkey_removed",
      actor: { type: "USER", id: userId },
      target: { type: "passkey", id: key.id, label: key.name ?? "passkey" },
    });
  });
}

/**
 * Runs before Better Auth deletes a user ("delete my account deletes
 * everything I own"):
 * - workspaces where the user is the only member are deleted entirely;
 * - if the user is the only OWNER of a workspace that has other members,
 *   deletion is refused (make someone else owner, or delete it first);
 * - in shared workspaces the departure is audited (the membership row goes
 *   with the user).
 */
export async function prepareAccountDeletion(user: { id: string; email: string }): Promise<void> {
  const memberships = await userDb(user.id).membership.findMany({
    where: { userId: user.id },
    select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
  });
  const solo: typeof memberships = [];
  const shared: typeof memberships = [];
  const blockers: string[] = [];
  for (const m of memberships) {
    const db = tenantDb({ workspaceId: m.workspace.id, userId: user.id });
    const [members, owners] = await Promise.all([
      db.membership.count({ where: { workspaceId: m.workspace.id } }),
      db.membership.count({ where: { workspaceId: m.workspace.id, role: "OWNER" } }),
    ]);
    if (members === 1) solo.push(m);
    else if (m.role === "OWNER" && owners === 1) blockers.push(m.workspace.name);
    else shared.push(m);
  }
  if (blockers.length)
    throw new AccountError(
      `You are the only owner of ${blockers.join(", ")}. Make someone else owner or delete the workspace first.`,
    );
  for (const m of solo)
    await deleteWorkspace(
      {
        workspaceId: m.workspace.id,
        workspaceSlug: m.workspace.slug,
        workspaceName: m.workspace.name,
        userId: user.id,
        role: "OWNER",
      },
      m.workspace.name,
    );
  for (const m of shared)
    await recordAudit(tenantDb({ workspaceId: m.workspace.id, userId: user.id }), {
      workspaceId: m.workspace.id,
      action: "member.left",
      actor: { type: "USER", id: user.id, label: user.email },
      target: { type: "user", id: user.id, label: user.email },
      metadata: { reason: "account deleted" },
    });
  await recordAudit(userDb(user.id), {
    workspaceId: null,
    action: "auth.account_deleted",
    actor: { type: "USER", id: user.id, label: user.email },
    metadata: { workspacesDeleted: solo.length, workspacesLeft: shared.length },
  });
}
