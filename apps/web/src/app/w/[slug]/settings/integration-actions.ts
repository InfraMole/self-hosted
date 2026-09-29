// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ForbiddenError } from "@/server/authz";
import {
  IntegrationNotFoundError,
  createIntegration,
  deleteIntegration,
  safeMessage,
  syncIntegration,
  testIntegration,
  type IntegrationInput,
} from "@/server/modules/integrations/integrations";
import { requireWorkspace } from "@/server/tenancy";

export interface IntegrationActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function toError(error: unknown): IntegrationActionState {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return {
      error: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input",
    };
  }
  if (error instanceof ForbiddenError || error instanceof IntegrationNotFoundError)
    return { error: error.message };
  return { error: safeMessage(error) };
}

export async function testIntegrationAction(
  slug: string,
  input: IntegrationInput,
): Promise<IntegrationActionState> {
  const ctx = await requireWorkspace(slug);
  try {
    const plan = await testIntegration(ctx, input);
    const c = plan.counts;
    return {
      ok: plan.errors.length === 0,
      message:
        plan.errors.length > 0
          ? `Connected, but the data has ${plan.errors.length} problem(s): ${plan.errors[0]!.message}`
          : `Connected. An import would create ${c.create}, update ${c.update}, leave ${c.unchanged} unchanged and add ${c.relationships} relationships.`,
    };
  } catch (error) {
    return toError(error);
  }
}

/** Saves (secret sealed) and runs a first sync. */
export async function createIntegrationAction(
  slug: string,
  input: IntegrationInput,
): Promise<IntegrationActionState> {
  const ctx = await requireWorkspace(slug);
  try {
    const created = await createIntegration(ctx, input);
    const outcome = await syncIntegration(ctx, created.id);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return {
      ok: outcome.ok,
      message: outcome.ok
        ? `Saved and synced: ${outcome.message}.`
        : `Saved, but the first sync failed: ${outcome.message}`,
    };
  } catch (error) {
    return toError(error);
  }
}

export async function syncIntegrationAction(
  slug: string,
  id: string,
): Promise<IntegrationActionState> {
  const ctx = await requireWorkspace(slug);
  try {
    const outcome = await syncIntegration(ctx, id);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return outcome.ok ? { ok: true, message: outcome.message } : { error: outcome.message };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteIntegrationAction(
  slug: string,
  id: string,
  retire: boolean,
): Promise<{ error?: string; message?: string }> {
  const ctx = await requireWorkspace(slug);
  let retired: Awaited<ReturnType<typeof deleteIntegration>>;
  try {
    retired = await deleteIntegration(ctx, id, { retire });
  } catch (error) {
    return toError(error);
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return retired ? { message: `${retired.deleted} deleted, ${retired.archived} archived` } : {};
}
