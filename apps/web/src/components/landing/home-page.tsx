// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { redirect } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { getEnv } from "@/server/env";
import { stripeConfigured } from "@/server/modules/billing/gateway";
import { isDemoUser } from "@/server/modules/demo/demo";
import { listWorkspacesForUser } from "@/server/modules/workspaces/workspaces";
import { getSession } from "@/server/tenancy";
import { Landing } from "./landing";

/**
 * Entry point ("/" and "/es"). Signed in: first workspace (or onboarding).
 * Signed out: the public website on Cloud or with PUBLIC_SITE=true (M13);
 * other installs go straight to sign-in.
 */
export async function HomePage({ locale }: { locale: Locale }) {
  const session = await getSession();
  const env = getEnv();
  // The shared demo account (M13) still sees the public website at "/".
  const inDemo = isDemoUser(session?.user);
  if (!session || inDemo) {
    if (env.EDITION !== "cloud" && !env.PUBLIC_SITE) redirect("/sign-in");
    return (
      <Landing
        locale={locale}
        // A trial only when people can then pay for a plan (ADR-046).
        cloudSignup={env.EDITION === "cloud" && env.SIGNUP === "open" && stripeConfigured(env)}
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
