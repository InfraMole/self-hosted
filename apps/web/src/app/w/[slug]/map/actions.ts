// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import type { ViewActionResult } from "@/lib/map-view-state";
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
