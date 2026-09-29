// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { listWorkspacesForUser } from "@/server/modules/workspaces/workspaces";
import { requireUser } from "@/server/tenancy";
import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata: Metadata = { title: "Create workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(user.id);
  const isFirst = workspaces.length === 0;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <Logo className="mb-8 text-base" />
        <h1 className="text-lg font-medium tracking-tight">
          {isFirst ? "Create your workspace" : "New workspace"}
        </h1>
        <p className="text-muted mt-1 mb-6 text-sm">
          A workspace holds one infrastructure: its library, map and changes. MSPs typically use one
          per client.
        </p>
        <CreateWorkspaceForm />
        {!isFirst && (
          <Link
            href={`/w/${workspaces[0]!.slug}/library`}
            className="text-muted hover:text-foreground mt-6 inline-block text-xs"
          >
            ← Back to {workspaces[0]!.name}
          </Link>
        )}
      </div>
    </main>
  );
}
