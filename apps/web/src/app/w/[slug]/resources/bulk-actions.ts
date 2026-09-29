// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError } from "@/server/authz";
import { archiveResources, deleteResources } from "@/server/modules/resources/resources";
import { SourceError, retireSource } from "@/server/modules/resources/sources";
import { requireWorkspace } from "@/server/tenancy";

type Result = { error?: string; message?: string };

function failure(error: unknown): Result {
  if (error instanceof ForbiddenError || error instanceof SourceError)
    return { error: error.message };
  if (error instanceof ZodError) return { error: "Select between 1 and 500 resources." };
  throw error;
}

export async function archiveResourcesAction(slug: string, ids: string[]): Promise<Result> {
  const ctx = await requireWorkspace(slug);
  try {
    const n = await archiveResources(ctx, ids);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return { message: `${n} archived` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteResourcesAction(slug: string, ids: string[]): Promise<Result> {
  const ctx = await requireWorkspace(slug);
  try {
    const n = await deleteResources(ctx, ids);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return { message: `${n} deleted` };
  } catch (error) {
    return failure(error);
  }
}

/**
 * ADR-021: untouched → deleted, touched → archived. On success, redirects to
 * the Library with the outcome (the source no longer has anything to show).
 */
export async function retireSourceAction(slug: string, ref: string): Promise<Result> {
  const ctx = await requireWorkspace(slug);
  let outcome: { deleted: number; archived: number };
  try {
    outcome = await retireSource(ctx, ref);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  redirect(`/w/${ctx.workspaceSlug}/library?retired=${outcome.deleted}.${outcome.archived}`);
}
