// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { redirect } from "next/navigation";
import { mailerConfigured } from "@/server/mail";
import { MemberError, acceptInvitation } from "@/server/modules/members/members";
import { rateLimit } from "@/server/rate-limit";
import { requireUser } from "@/server/tenancy";

export async function acceptInvitationAction(token: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!rateLimit(`invite-accept:${user.id}`, 20, 10 * 60_000).allowed)
    return { error: "Too many attempts. Try again in a few minutes." };
  let slug: string;
  try {
    ({ slug } = await acceptInvitation(user, token, { requireVerifiedEmail: mailerConfigured() }));
  } catch (error) {
    if (error instanceof MemberError) return { error: error.message };
    throw error;
  }
  redirect(`/w/${slug}/library`);
}
