// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure authorisation helpers (no Next.js / DB imports) — unit tested.
 * Role capability matrix: docs/DATA_MODEL.md §2.
 */

export const ROLES = ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const;
export type Role = (typeof ROLES)[number];

export interface WorkspaceContext {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  userId: string;
  role: Role;
  /** Workspace policy: members must have 2FA enabled (M8c). */
  requireTwoFactor?: boolean;
}

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasRole(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertRole(ctx: WorkspaceContext, minimum: Role): void {
  if (!hasRole(ctx.role, minimum)) throw new ForbiddenError();
}
