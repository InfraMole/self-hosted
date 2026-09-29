// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { PlanLimitError } from "@/server/modules/billing/limits";
import { ZodError } from "zod";
import { ForbiddenError } from "@/server/authz";
import {
  ImportHasErrorsError,
  applyImport,
  previewImport,
  type ImportRequest,
  type ImportResult,
} from "@/server/modules/importers/importers";
import { requireWorkspace } from "@/server/tenancy";

/** Client-facing preview (no full resource payloads). */
export interface ImportPreview {
  format: string;
  counts: { create: number; update: number; unchanged: number; relationships: number };
  resources: {
    row: number;
    name: string;
    type: string;
    action: "create" | "update" | "unchanged";
    matchedBy: "externalId" | "name" | null;
    changes: string[];
  }[];
  relationships: {
    row: number;
    from: string;
    to: string;
    type: string;
    action: "create" | "exists";
  }[];
  errors: { row: number; message: string }[];
  warnings: string[];
}

function failure(error: unknown): { error: string } | null {
  if (
    error instanceof ForbiddenError ||
    error instanceof ImportHasErrorsError ||
    error instanceof PlanLimitError
  )
    return { error: error.message };
  if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Invalid input" };
  return null;
}

export async function previewImportAction(
  slug: string,
  request: ImportRequest,
): Promise<{ preview?: ImportPreview; error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    const plan = await previewImport(ctx, request);
    return {
      preview: {
        format: plan.format,
        counts: plan.counts,
        resources: plan.resources.map((r) => ({
          row: r.row,
          name: r.name,
          type: r.type,
          action: r.action,
          matchedBy: r.matchedBy,
          changes: r.changes,
        })),
        relationships: plan.relationships.map((r) => ({
          row: r.row,
          from: r.fromLabel,
          to: r.toLabel,
          type: r.type,
          action: r.action,
        })),
        errors: plan.errors,
        warnings: plan.warnings,
      },
    };
  } catch (error) {
    const f = failure(error);
    if (f) return f;
    throw error;
  }
}

export async function applyImportAction(
  slug: string,
  request: ImportRequest,
): Promise<{ result?: ImportResult; error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    const result = await applyImport(ctx, request);
    revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
    return { result };
  } catch (error) {
    const f = failure(error);
    if (f) return f;
    throw error;
  }
}
