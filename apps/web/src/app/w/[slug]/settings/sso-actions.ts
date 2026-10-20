// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ForbiddenError } from "@/server/authz";
import {
  SsoError,
  createSsoConnection,
  deleteSsoConnection,
  setSsoEnabled,
  updateSsoConnection,
  verifySsoDomain,
} from "@/server/modules/sso/sso";
import { requireWorkspace } from "@/server/tenancy";

export type SsoActionResult = { ok: true; id?: string } | { ok: false; error: string };

async function run(
  slug: string,
  fn: (ctx: Awaited<ReturnType<typeof requireWorkspace>>) => Promise<unknown>,
): Promise<SsoActionResult> {
  const ctx = await requireWorkspace(slug);
  try {
    const out = (await fn(ctx)) as { id?: string } | undefined;
    revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
    return { ok: true, id: out?.id };
  } catch (error) {
    if (error instanceof SsoError || error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    if (error instanceof ZodError)
      return { ok: false, error: error.issues[0]?.message ?? "Check the form." };
    throw error;
  }
}

export async function createSsoAction(slug: string, input: unknown) {
  return run(slug, (ctx) => createSsoConnection(ctx, input));
}
export async function updateSsoAction(slug: string, id: string, input: unknown) {
  return run(slug, (ctx) => updateSsoConnection(ctx, id, input));
}
export async function verifySsoDomainAction(slug: string, id: string) {
  return run(slug, (ctx) => verifySsoDomain(ctx, id));
}
export async function setSsoEnabledAction(slug: string, id: string, enabled: boolean) {
  return run(slug, (ctx) => setSsoEnabled(ctx, id, enabled));
}
export async function deleteSsoAction(slug: string, id: string) {
  return run(slug, (ctx) => deleteSsoConnection(ctx, id));
}
