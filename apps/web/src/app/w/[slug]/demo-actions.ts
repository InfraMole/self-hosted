// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { ensureDemo, isDemoUser, writableDemo } from "@/server/modules/demo/demo";
import { requireUser } from "@/server/tenancy";

/**
 * Private demo (M35): "Reset demo" rebuilds the example workspace now, so a
 * presentation starts from the same data. Only the demo account of a
 * writable demo can do it.
 */
export async function resetDemoAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!isDemoUser(user) || !writableDemo()) return { ok: false, error: "Not available." };
  await ensureDemo(new Date(), { force: true });
  revalidatePath("/w", "layout");
  return { ok: true };
}
