// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { redirect } from "next/navigation";
import {
  WorkspaceLimitError,
  createWorkspace,
  createWorkspaceInput,
} from "@/server/modules/workspaces/workspaces";
import {
  InstanceWorkspaceLimitError,
  assertCanCreateWorkspace,
} from "@/server/modules/billing/limits";
import { requireUser } from "@/server/tenancy";

export interface CreateWorkspaceState {
  error?: string;
}

export async function createWorkspaceAction(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const user = await requireUser();
  const parsed = createWorkspaceInput.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };

  let slug: string;
  try {
    await assertCanCreateWorkspace();
    slug = (await createWorkspace(user.id, parsed.data)).slug;
  } catch (error) {
    if (error instanceof WorkspaceLimitError || error instanceof InstanceWorkspaceLimitError)
      return { error: error.message };
    throw error;
  }
  redirect(`/w/${slug}/library`);
}
