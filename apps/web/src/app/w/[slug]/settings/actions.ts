// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/server/authz";
import { getEnv } from "@/server/env";
import {
  AgentNotFoundError,
  createEnrollmentToken,
  createTokenSchema,
  revokeAgent,
  revokeEnrollmentToken,
} from "@/server/modules/agents/agents";
import { requireWorkspace } from "@/server/tenancy";

export interface CreateTokenState {
  error?: string;
  /** Shown once. */
  token?: string;
  name?: string;
  expiresAt?: string;
  serverUrl?: string;
  insecure?: boolean;
  /** Release base URL for signed agent binaries (AGENT_DOWNLOAD_BASE_URL). */
  downloadBaseUrl?: string | null;
}

export async function createTokenAction(
  slug: string,
  formData: FormData,
): Promise<CreateTokenState> {
  const ctx = await requireWorkspace(slug);
  const maxUses = String(formData.get("maxUses") ?? "").trim();
  const parsed = createTokenSchema.safeParse({
    name: formData.get("name"),
    expiresInHours: formData.get("expiresInHours"),
    maxUses: maxUses === "" ? null : maxUses,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const created = await createEnrollmentToken(ctx, parsed.data);
    revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
    const serverUrl = getEnv().BETTER_AUTH_URL.replace(/\/$/, "");
    return {
      token: created.token,
      name: created.name,
      expiresAt: created.expiresAt.toISOString(),
      serverUrl,
      insecure: serverUrl.startsWith("http://"),
      downloadBaseUrl: getEnv().AGENT_DOWNLOAD_BASE_URL ?? null,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }
}

async function guarded(
  slug: string,
  fn: (ctx: Awaited<ReturnType<typeof requireWorkspace>>) => Promise<void>,
) {
  const ctx = await requireWorkspace(slug);
  try {
    await fn(ctx);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof AgentNotFoundError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return {};
}

export async function revokeTokenAction(
  slug: string,
  tokenId: string,
): Promise<{ error?: string }> {
  return guarded(slug, (ctx) => revokeEnrollmentToken(ctx, tokenId));
}

export async function revokeAgentAction(
  slug: string,
  agentId: string,
): Promise<{ error?: string }> {
  return guarded(slug, (ctx) => revokeAgent(ctx, agentId));
}
