// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/landing";
import { getEnv } from "@/server/env";
import { isDemoUser } from "@/server/modules/demo/demo";
import { listWorkspacesForUser } from "@/server/modules/workspaces/workspaces";
import { getSession } from "@/server/tenancy";

export const metadata: Metadata = {
  title: { absolute: "InfraMole — See what depends on what" },
};

/**
 * Entry point. Signed in: first workspace (or onboarding). Signed out: the
 * public website on Cloud or with PUBLIC_SITE=true (M13); other installs go
 * straight to sign-in.
 */
export default async function Home() {
  const session = await getSession();
  const env = getEnv();
  // The shared demo account (M13) still sees the public website at "/".
  const inDemo = isDemoUser(session?.user);
  if (!session || inDemo) {
    if (env.EDITION !== "cloud" && !env.PUBLIC_SITE) redirect("/sign-in");
    return (
      <Landing
        cloudSignup={env.EDITION === "cloud" && env.SIGNUP === "open"}
        demo={env.DEMO_MODE}
        inDemo={inDemo}
        showPrices={env.EDITION === "cloud"}
      />
    );
  }
  const [first] = await listWorkspacesForUser(session.user.id);
  if (!first) redirect("/onboarding");
  redirect(`/w/${first.slug}/library`);
}
