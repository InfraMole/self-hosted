// SPDX-License-Identifier: AGPL-3.0-only
import { Sidebar } from "@/components/app-shell/sidebar";
import { UsageBanner } from "@/components/billing/usage-banner";
import { DemoBanner } from "@/components/demo/demo-banner";
import { getEnv } from "@/server/env";
import { isDemoUser, writableDemo } from "@/server/modules/demo/demo";
import { hasRole } from "@/server/authz";
import { getUsage } from "@/server/modules/billing/limits";
import { countSuggestions } from "@/server/modules/discovery/discovery";
import { feedbackEnabled } from "@/server/modules/feedback/feedback";
import { listWorkspacesForUser } from "@/server/modules/workspaces/workspaces";
import { requireUser, requireWorkspace } from "@/server/tenancy";
import { resetDemoAction } from "./demo-actions";
import { sendFeedbackAction } from "./feedback-actions";
import { searchResourcesAction } from "./search-actions";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const user = await requireUser();
  const [workspaces, suggestionCount, usage] = await Promise.all([
    listWorkspacesForUser(ctx.userId),
    countSuggestions(ctx),
    getUsage(ctx.workspaceId),
  ]);

  return (
    <div className="flex h-dvh print:block print:h-auto">
      <div className="contents print:hidden">
        <Sidebar
          workspace={{ name: ctx.workspaceName, slug: ctx.workspaceSlug }}
          workspaces={workspaces.map(({ name, slug }) => ({ name, slug }))}
          user={{ name: user.name, email: user.email }}
          suggestionCount={suggestionCount}
          feedbackAction={
            feedbackEnabled() ? sendFeedbackAction.bind(null, ctx.workspaceSlug) : null
          }
          search={searchResourcesAction.bind(null, ctx.workspaceSlug)}
        />
      </div>
      <main className="flex min-w-0 flex-1 flex-col overflow-auto print:block print:overflow-visible">
        <div className="contents print:hidden">
          {isDemoUser(user) && (
            <DemoBanner
              reset={writableDemo() ? resetDemoAction : undefined}
              resetHours={getEnv().DEMO_RESET_HOURS}
            />
          )}
          <UsageBanner
            usage={usage}
            billingHref={
              hasRole(ctx.role, "ADMIN") ? `/w/${ctx.workspaceSlug}/settings/billing` : null
            }
          />
        </div>
        {children}
      </main>
    </div>
  );
}
