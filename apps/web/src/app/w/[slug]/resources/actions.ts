// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { PlanLimitError } from "@/server/modules/billing/limits";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/server/authz";
import { refreshDetectedRelationships } from "@/server/modules/discovery/discovery";
import {
  ResourceNotFoundError,
  createResource,
  deleteResource,
  updateResource,
} from "@/server/modules/resources/resources";
import {
  fieldErrors,
  resourceFormToInput,
  resourceInputSchema,
} from "@/server/modules/resources/schemas";
import { requireWorkspace } from "@/server/tenancy";

export interface ResourceFormState {
  ok?: boolean;
  resourceId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** Create (resourceId = null) or update a resource. Bound with slug/id by the page. */
export async function saveResourceAction(
  slug: string,
  resourceId: string | null,
  formData: FormData,
): Promise<ResourceFormState> {
  const ctx = await requireWorkspace(slug);
  const parsed = resourceInputSchema.safeParse(resourceFormToInput(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    const resource = resourceId
      ? await updateResource(ctx, resourceId, parsed.data)
      : await createResource(ctx, parsed.data);
    // New/changed IPs may turn unknown endpoints into suggestions (no-op without agents).
    await refreshDetectedRelationships(ctx.workspaceId);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return { ok: true, resourceId: resource.id };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof PlanLimitError)
      return { error: error.message };
    if (error instanceof ResourceNotFoundError) return { error: "This resource no longer exists." };
    throw error;
  }
}

export async function deleteResourceAction(
  slug: string,
  resourceId: string,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await deleteResource(ctx, resourceId);
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    if (!(error instanceof ResourceNotFoundError)) throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  redirect(`/w/${ctx.workspaceSlug}/library`);
}
