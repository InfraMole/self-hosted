// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/landing";
import { getEnv } from "@/server/env";
import { listWorkspacesForUser } from "@/server/modules/workspaces/workspaces";
import { getSession } from "@/server/tenancy";

export const metadata: Metadata = {
  title: { absolute: "InfraMole — See what depends on what" },
};

/**
 * Entry point. Signed in: first workspace (or onboarding). Signed out: the
 * public landing page on Cloud; self-hosted installs go straight to sign-in.
 */
export default async function Home() {
  const session = await getSession();
  if (!session) {
    if (getEnv().EDITION !== "cloud") redirect("/sign-in");
    return <Landing />;
  }
  const [first] = await listWorkspacesForUser(session.user.id);
  if (!first) redirect("/onboarding");
  redirect(`/w/${first.slug}/library`);
}
