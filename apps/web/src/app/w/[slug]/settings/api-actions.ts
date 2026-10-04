// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/server/authz";
import { getEnv } from "@/server/env";
import {
  ApiTokenError,
  createApiToken,
  createApiTokenSchema,
  revokeApiToken,
} from "@/server/modules/api/tokens";
import { ShareError, revokeShare } from "@/server/modules/map/shares";
import { requireWorkspace } from "@/server/tenancy";

export interface CreateApiTokenState {
  error?: string;
  /** Shown once. */
  token?: string;
  expiresAt?: string | null;
  /** Base URL of this server, for the example request. */
  serverUrl?: string;
}

export async function createApiTokenAction(
  slug: string,
  formData: FormData,
): Promise<CreateApiTokenState> {
  const ctx = await requireWorkspace(slug);
  const parsed = createApiTokenSchema.safeParse({
    name: formData.get("name"),
    expiresInDays: formData.get("expiresInDays"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const created = await createApiToken(ctx, parsed.data);
    revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
    return {
      token: created.token,
      expiresAt: created.expiresAt?.toISOString() ?? null,
      serverUrl: getEnv().BETTER_AUTH_URL.replace(/\/$/, ""),
    };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ApiTokenError)
      return { error: error.message };
    throw error;
  }
}

export async function revokeApiTokenAction(
  slug: string,
  tokenId: string,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await revokeApiToken(ctx, tokenId);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ApiTokenError)
      return { error: error.message };
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
  return {};
}

/** Revoke a public map link (M31). */
export async function revokeShareAction(
  slug: string,
  shareId: string,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await revokeShare(ctx, shareId);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ShareError)
      return { error: error.message };
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
  return {};
}
