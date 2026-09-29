// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import type { WorkspaceContext } from "@/server/authz";
import { getEnv } from "@/server/env";
import { mailerConfigured, sendMail } from "@/server/mail";
import { rateLimit } from "@/server/rate-limit";

/**
 * In-app feedback (M12): emailed to FEEDBACK_EMAIL as plain text, with the
 * sender as Reply-To. Nothing is stored and no third-party widget is loaded.
 * Any member (viewers included) can send; rate limited per user.
 */
export const FEEDBACK_KINDS = ["problem", "idea", "other"] as const;

export const feedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z
    .string()
    .trim()
    .min(3, "Write a few words.")
    .max(4000, "Keep it under 4,000 characters."),
  /** The page it was sent from: a path only, never a full URL or query. */
  page: z
    .string()
    .max(200)
    .regex(/^\/[\w\-./[\]]*$/)
    .optional()
    .catch(undefined),
});
export type FeedbackInput = z.input<typeof feedbackInputSchema>;

export class FeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackError";
  }
}

export const FEEDBACK_PER_HOUR = 5;

export function feedbackEnabled(): boolean {
  return Boolean(getEnv().FEEDBACK_EMAIL) && mailerConfigured();
}

export async function sendFeedback(
  ctx: WorkspaceContext,
  sender: { name: string; email: string },
  input: FeedbackInput,
): Promise<void> {
  const { kind, message, page } = feedbackInputSchema.parse(input);
  if (!feedbackEnabled()) throw new FeedbackError("Feedback is not enabled on this installation.");
  if (!rateLimit(`feedback:${ctx.userId}`, FEEDBACK_PER_HOUR, 3_600_000).allowed)
    throw new FeedbackError("Thanks — that is a lot of feedback for one hour. Try again later.");
  await sendMail({
    to: getEnv().FEEDBACK_EMAIL!,
    replyTo: sender.email,
    subject: `[feedback/${kind}] ${ctx.workspaceSlug}`,
    text: [
      `From: ${sender.name} <${sender.email}> (${ctx.role.toLowerCase()})`,
      `Workspace: ${ctx.workspaceName} (${ctx.workspaceSlug})`,
      `Page: ${page ?? "—"}`,
      `Edition: ${getEnv().EDITION}`,
      "",
      message,
    ].join("\n"),
  });
}
