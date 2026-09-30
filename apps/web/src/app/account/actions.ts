// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import {
  AccountError,
  removePasskey,
  syncPasskeyAudit,
  syncTwoFactorAudit,
} from "@/server/modules/account/account";
import { isDemoUser } from "@/server/modules/demo/demo";
import { setWeeklyDigest } from "@/server/modules/digest/digest";
import { requireUser, requireWorkspace } from "@/server/tenancy";

/** Called after a Better Auth 2FA change; records what the database says happened. */
export async function twoFactorChangedAction(): Promise<void> {
  const user = await requireUser();
  await syncTwoFactorAudit(user.id);
  revalidatePath("/account");
}

export async function passkeyAddedAction(): Promise<void> {
  const user = await requireUser();
  await syncPasskeyAudit(user.id);
  revalidatePath("/account");
}

export async function removePasskeyAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  try {
    await removePasskey(user.id, id);
  } catch (error) {
    if (error instanceof AccountError) return { error: error.message };
    throw error;
  }
  revalidatePath("/account");
  return {};
}

/** M21: weekly email summary of changes, per workspace (personal preference). */
export async function setWeeklyDigestAction(
  workspaceSlug: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const user = await requireUser();
  if (isDemoUser(user)) return { error: "The demo account cannot receive email." };
  const ctx = await requireWorkspace(workspaceSlug);
  await setWeeklyDigest(ctx, enabled);
  revalidatePath("/account");
  return {};
}
