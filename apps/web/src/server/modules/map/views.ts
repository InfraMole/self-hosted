// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import {
  SAVED_VIEWS_LIMIT,
  savedViewNameSchema,
  savedViewStateSchema,
  type SavedViewSummary,
} from "@/lib/map-view-state";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";

/**
 * Saved map views (M26 phase 3, ADR-041). Shared with the whole workspace:
 * anyone can open them, MEMBER+ save and delete them. They are presentation
 * (filters, boxes, positions), not infrastructure data, so they record no
 * ChangeEvent and are not security events (no audit entry).
 */

export const saveViewSchema = z.object({
  /** Overwrite this view; omitted = create a new one. */
  id: z.string().min(1).max(64).optional(),
  name: savedViewNameSchema,
  state: savedViewStateSchema,
});
export type SaveViewInput = z.input<typeof saveViewSchema>;

export class SavedViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedViewError";
  }
}

export async function listSavedViews(ctx: WorkspaceContext): Promise<SavedViewSummary[]> {
  const rows = await tenantDb(ctx).savedView.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, state: true, updatedAt: true },
  });
  // A row that no longer validates (older shape) is skipped, never thrown.
  return rows.flatMap((r) => {
    const state = savedViewStateSchema.safeParse(r.state);
    return state.success
      ? [{ id: r.id, name: r.name, state: state.data, updatedAt: r.updatedAt.toISOString() }]
      : [];
  });
}

export async function saveView(ctx: WorkspaceContext, rawInput: unknown): Promise<{ id: string }> {
  assertRole(ctx, "MEMBER");
  const input = saveViewSchema.parse(rawInput);
  const db = tenantDb(ctx);
  try {
    return await db.$transaction(async (tx) => {
      if (input.id) {
        const { count } = await tx.savedView.updateMany({
          where: { id: input.id, workspaceId: ctx.workspaceId },
          data: { name: input.name, state: input.state },
        });
        if (count === 0) throw new SavedViewError("That view no longer exists.");
        return { id: input.id };
      }
      if (
        (await tx.savedView.count({ where: { workspaceId: ctx.workspaceId } })) >= SAVED_VIEWS_LIMIT
      )
        throw new SavedViewError(`A workspace can have up to ${SAVED_VIEWS_LIMIT} saved views.`);
      const created = await tx.savedView.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: input.name,
          state: input.state,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new SavedViewError("A view with that name already exists.");
    throw error;
  }
}

export async function deleteSavedView(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "MEMBER");
  if (!id || id.length > 64) throw new SavedViewError("That view no longer exists.");
  const { count } = await tenantDb(ctx).savedView.deleteMany({
    where: { id, workspaceId: ctx.workspaceId },
  });
  if (count === 0) throw new SavedViewError("That view no longer exists.");
}
