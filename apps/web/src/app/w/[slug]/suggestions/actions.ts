// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/server/authz";
import {
  RelationshipAlreadyReviewedError,
  RelationshipExistsError,
  RelationshipNotFoundError,
  confirmRelationship,
  ignoreRelationship,
} from "@/server/modules/relationships/relationships";
import { relationshipUpdateSchema } from "@/server/modules/relationships/schemas";
import { requireWorkspace } from "@/server/tenancy";

export interface ReviewState {
  ok?: boolean;
  error?: string;
}

function known(error: unknown): ReviewState | null {
  if (
    error instanceof ForbiddenError ||
    error instanceof RelationshipAlreadyReviewedError ||
    error instanceof RelationshipExistsError
  ) {
    return { error: error.message };
  }
  if (error instanceof RelationshipNotFoundError)
    return { error: "This suggestion no longer exists." };
  return null;
}

/** Confirm as-is, or with a type/note ("Add context"). */
export async function confirmSuggestionAction(
  slug: string,
  relationshipId: string,
  input: { type?: string; note?: string } = {},
): Promise<ReviewState> {
  const ctx = await requireWorkspace(slug);
  const parsed = relationshipUpdateSchema.partial().safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    await confirmRelationship(ctx, relationshipId, parsed.data);
  } catch (error) {
    const k = known(error);
    if (k) return k;
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return { ok: true };
}

export async function ignoreSuggestionAction(
  slug: string,
  relationshipId: string,
): Promise<ReviewState> {
  const ctx = await requireWorkspace(slug);
  try {
    await ignoreRelationship(ctx, relationshipId);
  } catch (error) {
    const k = known(error);
    if (k) return k;
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return { ok: true };
}
