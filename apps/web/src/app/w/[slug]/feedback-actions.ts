// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { ZodError } from "zod";
import {
  FeedbackError,
  sendFeedback,
  type FeedbackInput,
} from "@/server/modules/feedback/feedback";
import { requireUser, requireWorkspace } from "@/server/tenancy";

export async function sendFeedbackAction(
  slug: string,
  input: FeedbackInput,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await requireWorkspace(slug);
  const user = await requireUser();
  try {
    await sendFeedback(ctx, { name: user.name, email: user.email }, input);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Invalid input." };
    if (error instanceof FeedbackError) return { error: error.message };
    console.warn("[feedback] not sent:", error instanceof Error ? error.message : "error");
    return { error: "Could not send it right now. Try again in a moment." };
  }
}
