// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ForbiddenError } from "@/server/authz";
import {
  DiscoveryRuleError,
  applyRuleTemplate,
  createDiscoveryRule,
  deleteDiscoveryRule,
  discoveryRuleSchema,
} from "@/server/modules/discovery/rules";
import {
  RelationshipAlreadyReviewedError,
  RelationshipExistsError,
  RelationshipNotFoundError,
  confirmRelationship,
  confirmRelationships,
  ignoreRelationship,
  ignoreRelationships,
  restoreRelationships,
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

// ───────────────────────── Bulk review and rules (M15) ─────────────────────────

export interface BulkState {
  message?: string;
  error?: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function bulk(
  slug: string,
  run: (ctx: Awaited<ReturnType<typeof requireWorkspace>>) => Promise<string>,
): Promise<BulkState> {
  const ctx = await requireWorkspace(slug);
  try {
    const message = await run(ctx);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return { message };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    if (error instanceof ZodError) return { error: "Select between 1 and 1000 suggestions." };
    throw error;
  }
}

export async function confirmSuggestionsAction(
  slug: string,
  ids: string[],
  useSuggestedType: boolean,
): Promise<BulkState> {
  return bulk(slug, async (ctx) => {
    const n = await confirmRelationships(ctx, ids, { useSuggestedType });
    return `Confirmed ${plural(n, "suggestion")}.`;
  });
}

export async function ignoreSuggestionsAction(slug: string, ids: string[]): Promise<BulkState> {
  return bulk(slug, async (ctx) => {
    const n = await ignoreRelationships(ctx, ids);
    return `Ignored ${plural(n, "suggestion")}.`;
  });
}

export async function restoreSuggestionsAction(slug: string, ids: string[]): Promise<BulkState> {
  return bulk(slug, async (ctx) => {
    const n = await restoreRelationships(ctx, ids);
    return `Restored ${plural(n, "suggestion")} to the inbox.`;
  });
}

export interface RuleState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function createRuleAction(slug: string, input: unknown): Promise<RuleState> {
  const ctx = await requireWorkspace(slug);
  const parsed = discoveryRuleSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0] ?? "port")] ??= issue.message;
    return { fieldErrors };
  }
  try {
    const { removed } = await createDiscoveryRule(ctx, parsed.data);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return {
      ok: true,
      message: removed
        ? `Rule added. ${plural(removed, "matching suggestion")} removed.`
        : "Rule added.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof DiscoveryRuleError)
      return { error: error.message };
    throw error;
  }
}

export async function deleteRuleAction(slug: string, id: string): Promise<RuleState> {
  const ctx = await requireWorkspace(slug);
  try {
    await deleteDiscoveryRule(ctx, id);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof DiscoveryRuleError)
      return { error: error.message };
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return { ok: true, message: "Rule removed. Matching traffic can be suggested again." };
}

export async function applyRuleTemplateAction(
  slug: string,
  templateId: string,
): Promise<RuleState> {
  const ctx = await requireWorkspace(slug);
  try {
    const { added, removed } = await applyRuleTemplate(ctx, templateId);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return {
      ok: true,
      message:
        added === 0
          ? "These rules were already in place."
          : `Added ${plural(added, "rule")}.${removed ? ` ${plural(removed, "matching suggestion")} removed.` : ""}`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof DiscoveryRuleError)
      return { error: error.message };
    throw error;
  }
}
