// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "./auth";
import type { WorkspaceContext } from "./authz";
import { findWorkspaceContextForUser } from "./modules/workspaces/workspaces";

/** Current session (deduplicated per request). */
export const getSession = cache(async () => {
  // Read headers first: it marks the route dynamic before any env/DB access.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** Signed-in user or redirect to /sign-in. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}

/**
 * Resolves the workspace *through the user's membership*. Non-members get a
 * 404 so we never reveal whether a workspace exists (docs/SECURITY.md T1).
 * Call this in every workspace page / action, not only in layouts.
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const ctx = await findWorkspaceContextForUser(user.id, slug);
  if (!ctx) notFound();
  // Workspace 2FA policy (M8c): members without 2FA are sent to set it up.
  if (ctx.requireTwoFactor && !user.twoFactorEnabled)
    redirect(`/account?required=${encodeURIComponent(ctx.workspaceName)}`);
  return ctx;
});
