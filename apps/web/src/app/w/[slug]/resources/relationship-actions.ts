// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/server/authz";
import {
  RelationshipEndpointError,
  RelationshipExistsError,
  RelationshipNotFoundError,
  createRelationship,
  deleteRelationship,
  updateRelationship,
} from "@/server/modules/relationships/relationships";
import {
  relationshipCreateSchema,
  relationshipFieldErrors,
  relationshipFormToCreateInput,
  relationshipFormToUpdateInput,
  relationshipUpdateSchema,
} from "@/server/modules/relationships/schemas";
import { requireWorkspace } from "@/server/tenancy";

export interface RelationshipFormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function knownError(error: unknown): RelationshipFormState | null {
  if (
    error instanceof ForbiddenError ||
    error instanceof RelationshipExistsError ||
    error instanceof RelationshipEndpointError
  ) {
    return { error: error.message };
  }
  if (error instanceof RelationshipNotFoundError) {
    return { error: "This relationship no longer exists." };
  }
  return null;
}

/** Bound by the page with (slug, viewerResourceId). */
export async function createRelationshipAction(
  slug: string,
  viewerResourceId: string,
  formData: FormData,
): Promise<RelationshipFormState> {
  const ctx = await requireWorkspace(slug);
  const parsed = relationshipCreateSchema.safeParse(
    relationshipFormToCreateInput(formData, viewerResourceId),
  );
  if (!parsed.success) return { fieldErrors: relationshipFieldErrors(parsed.error) };
  try {
    await createRelationship(ctx, parsed.data);
  } catch (error) {
    const known = knownError(error);
    if (known) return known;
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return { ok: true };
}

export async function updateRelationshipAction(
  slug: string,
  relationshipId: string,
  formData: FormData,
): Promise<RelationshipFormState> {
  const ctx = await requireWorkspace(slug);
  const parsed = relationshipUpdateSchema.safeParse(relationshipFormToUpdateInput(formData));
  if (!parsed.success) return { fieldErrors: relationshipFieldErrors(parsed.error) };
  try {
    await updateRelationship(ctx, relationshipId, parsed.data);
  } catch (error) {
    const known = knownError(error);
    if (known) return known;
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return { ok: true };
}

export async function deleteRelationshipAction(
  slug: string,
  relationshipId: string,
): Promise<RelationshipFormState> {
  const ctx = await requireWorkspace(slug);
  try {
    await deleteRelationship(ctx, relationshipId);
  } catch (error) {
    const known = knownError(error);
    if (known) return known;
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return { ok: true };
}
