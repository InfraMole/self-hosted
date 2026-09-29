// SPDX-License-Identifier: AGPL-3.0-only
import { ForbiddenError } from "@/server/authz";
import { getSession } from "@/server/tenancy";
import { exportWorkspace } from "@/server/modules/workspaces/export";
import { findWorkspaceContextForUser } from "@/server/modules/workspaces/workspaces";

export const dynamic = "force-dynamic";

/**
 * GET → JSON download of the workspace (ADMIN+). Same access rules as
 * requireWorkspace: non-members and lower roles get 404; the 2FA policy applies.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/w/[slug]/settings/export">,
) {
  const { slug } = await params;
  const session = await getSession();
  const notFound = () => Response.json({ error: "not_found" }, { status: 404 });
  if (!session) return notFound();
  const ctx = await findWorkspaceContextForUser(session.user.id, slug);
  if (!ctx) return notFound();
  if (ctx.requireTwoFactor && !session.user.twoFactorEnabled) return notFound();
  try {
    const data = await exportWorkspace(ctx);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="inframole-${ctx.workspaceSlug}-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return notFound();
    throw error;
  }
}
