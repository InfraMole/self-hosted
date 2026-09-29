// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError, type Role } from "@/server/authz";
import { getEnv } from "@/server/env";
import { MemberLimitError } from "@/server/modules/billing/limits";
import { invitationMail, mailerConfigured, sendMail } from "@/server/mail";
import {
  MemberError,
  changeMemberRole,
  createInvitation,
  removeMember,
  revokeInvitation,
  type InvitationInput,
} from "@/server/modules/members/members";
import { requireUser, requireWorkspace } from "@/server/tenancy";

function toError(error: unknown): { error: string } {
  if (error instanceof ZodError) return { error: error.issues[0]?.message ?? "Invalid input." };
  if (
    error instanceof ForbiddenError ||
    error instanceof MemberError ||
    error instanceof MemberLimitError
  )
    return { error: error.message };
  throw error;
}

export interface InviteState {
  error?: string;
  link?: string;
  email?: string;
  /** Also sent by email (a mailer is configured and sending worked). */
  emailed?: boolean;
}

export async function inviteMemberAction(
  slug: string,
  input: InvitationInput,
): Promise<InviteState> {
  const ctx = await requireWorkspace(slug);
  try {
    const { token, email, role } = await createInvitation(ctx, input);
    const link = `${getEnv().BETTER_AUTH_URL.replace(/\/$/, "")}/invite/${token}`;
    let emailed = false;
    if (mailerConfigured()) {
      const inviter = (await requireUser()).name;
      try {
        await sendMail(invitationMail(email, inviter, ctx.workspaceName, role.toLowerCase(), link));
        emailed = true;
      } catch (error) {
        // The link is still shown to the inviter; never fail the invitation.
        console.warn(
          "[mail] invitation not sent:",
          error instanceof Error ? error.message : "error",
        );
      }
    }
    revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
    return { link, email, emailed };
  } catch (error) {
    return toError(error);
  }
}

export async function revokeInvitationAction(
  slug: string,
  id: string,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await revokeInvitation(ctx, id);
  } catch (error) {
    return toError(error);
  }
  revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
  return {};
}

export async function changeRoleAction(
  slug: string,
  userId: string,
  role: Role,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await changeMemberRole(ctx, userId, role);
  } catch (error) {
    return toError(error);
  }
  revalidatePath(`/w/${ctx.workspaceSlug}`, "layout");
  return {};
}

export async function removeMemberAction(
  slug: string,
  userId: string,
): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  try {
    await removeMember(ctx, userId);
  } catch (error) {
    return toError(error);
  }
  if (userId === ctx.userId) redirect("/"); // left the workspace
  revalidatePath(`/w/${ctx.workspaceSlug}/settings`);
  return {};
}
