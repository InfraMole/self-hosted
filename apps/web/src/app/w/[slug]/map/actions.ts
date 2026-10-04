// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { ShareResult } from "@/components/map/share-view-dialog";
import type { ViewActionResult } from "@/lib/map-view-state";
import { getEnv } from "@/server/env";
import { ShareError, createShare } from "@/server/modules/map/shares";
import { ForbiddenError } from "@/server/authz";
import { SavedViewError, deleteSavedView, saveView } from "@/server/modules/map/views";
import { requireWorkspace } from "@/server/tenancy";

function known(error: unknown): ViewActionResult | null {
  if (error instanceof ForbiddenError || error instanceof SavedViewError)
    return { ok: false, error: error.message };
  if (error instanceof ZodError)
    return { ok: false, error: error.issues[0]?.message ?? "Invalid view" };
  return null;
}

/** Create (no id) or overwrite a saved map view. */
export async function saveViewAction(slug: string, input: unknown): Promise<ViewActionResult> {
  const ctx = await requireWorkspace(slug);
  try {
    const { id } = await saveView(ctx, input);
    revalidatePath(`/w/${ctx.workspaceSlug}/map`);
    return { ok: true, id };
  } catch (error) {
    const k = known(error);
    if (k) return k;
    throw error;
  }
}

export async function deleteViewAction(slug: string, id: string): Promise<ViewActionResult> {
  const ctx = await requireWorkspace(slug);
  try {
    await deleteSavedView(ctx, id);
    revalidatePath(`/w/${ctx.workspaceSlug}/map`);
    return { ok: true };
  } catch (error) {
    const k = known(error);
    if (k) return k;
    throw error;
  }
}

/** Public read-only link to a saved view (M31, ADMIN+). The URL is returned once. */
export async function shareViewAction(
  slug: string,
  viewId: string,
  expiresInDays: number,
): Promise<ShareResult> {
  const ctx = await requireWorkspace(slug);
  try {
    const created = await createShare(ctx, { viewId, expiresInDays });
    revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
    return {
      ok: true,
      url: `${getEnv().BETTER_AUTH_URL.replace(/\/$/, "")}/share/${created.token}`,
      expiresAt: created.expiresAt?.toISOString() ?? null,
    };
  } catch (error) {
    if (error instanceof ShareError) return { ok: false, error: error.message };
    const k = known(error);
    if (k && !k.ok) return k;
    throw error;
  }
}
