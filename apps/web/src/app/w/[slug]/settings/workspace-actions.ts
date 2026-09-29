// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/server/authz";
import {
  WorkspaceDeleteError,
  WorkspaceSettingsError,
  deleteWorkspace,
  setRequireTwoFactor,
} from "@/server/modules/workspaces/workspaces";
import { requireWorkspace } from "@/server/tenancy";

export async function setRequireTwoFactorAction(
  slug: string,
  value: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await setRequireTwoFactor(ctx, value);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof WorkspaceSettingsError)
      return { error: error.message };
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
  return {};
}

/** OWNER. Deletes the workspace and everything in it, then leaves the page. */
export async function deleteWorkspaceAction(
  slug: string,
  confirmName: string,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await deleteWorkspace(ctx, confirmName);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof WorkspaceDeleteError)
      return { error: error.message };
    throw error;
  }
  redirect("/");
}
