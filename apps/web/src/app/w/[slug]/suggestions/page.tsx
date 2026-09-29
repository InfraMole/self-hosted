// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RulesPanel } from "@/components/suggestions/rules-panel";
import { SuggestionInbox } from "@/components/suggestions/suggestion-inbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hasRole } from "@/server/authz";
import {
  SUGGESTIONS_PAGE,
  countSuggestions,
  listSuggestions,
} from "@/server/modules/discovery/discovery";
import { listDiscoveryRules, listRuleResourceOptions } from "@/server/modules/discovery/rules";
import { requireWorkspace } from "@/server/tenancy";
import {
  confirmSuggestionAction,
  confirmSuggestionsAction,
  createRuleAction,
  deleteRuleAction,
  ignoreSuggestionAction,
  ignoreSuggestionsAction,
  restoreSuggestionsAction,
} from "./actions";

export const metadata: Metadata = { title: "Suggestions" };

type View = "review" | "ignored" | "rules";

export default async function SuggestionsPage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/suggestions">) {
  const { slug } = await params;
  const { view: rawView } = await searchParams;
  const view: View = rawView === "ignored" || rawView === "rules" ? rawView : "review";
  const ctx = await requireWorkspace(slug);
  const canReview = hasRole(ctx.role, "MEMBER");
  const base = `/w/${ctx.workspaceSlug}`;

  const [toReview, ignored, rules] = await Promise.all([
    countSuggestions(ctx),
    countSuggestions(ctx, "IGNORED"),
    listDiscoveryRules(ctx),
  ]);

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "review", label: "To review", count: toReview },
    { key: "ignored", label: "Ignored", count: ignored },
    { key: "rules", label: "Rules", count: rules.length },
  ];

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="Relationships detected by agents. Nothing becomes a dependency until you confirm it."
      />
      <div className="flex max-w-5xl flex-1 flex-col gap-4 p-6">
        <nav aria-label="Suggestions" className="border-border flex gap-5 border-b text-sm">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={
                t.key === "review" ? `${base}/suggestions` : `${base}/suggestions?view=${t.key}`
              }
              aria-current={view === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 pb-2",
                view === t.key
                  ? "border-accent text-foreground font-medium"
                  : "text-muted hover:text-foreground border-transparent",
              )}
            >
              {t.label} <span className="text-subtle font-mono text-xs">{t.count}</span>
            </Link>
          ))}
        </nav>

        {view === "rules" ? (
          <RulesPanel
            rules={rules}
            resources={canReview ? await listRuleResourceOptions(ctx) : []}
            canEdit={canReview}
            createRule={createRuleAction.bind(null, ctx.workspaceSlug)}
            deleteRule={deleteRuleAction.bind(null, ctx.workspaceSlug)}
          />
        ) : view === "ignored" ? (
          ignored === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nothing ignored"
              description="Suggestions you ignore are kept here, so you can restore them if you change your mind."
            />
          ) : (
            <SuggestionInbox
              slug={ctx.workspaceSlug}
              mode="ignored"
              suggestions={await listSuggestions(ctx, "IGNORED")}
              canReview={canReview}
              restoreMany={restoreSuggestionsAction.bind(null, ctx.workspaceSlug)}
            />
          )
        ) : toReview === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No suggestions to review"
            description="When agents see connections between resources in your Library, they appear here. Unknown IPs are listed on each host until you add a resource with that address."
          >
            <Button size="sm" variant="secondary" asChild>
              <Link href={`${base}/settings#agents`}>Manage agents</Link>
            </Button>
          </EmptyState>
        ) : (
          <>
            <p className="text-muted text-xs">
              {toReview} to review · detected connections are leads, not proof of a dependency.
              {toReview > SUGGESTIONS_PAGE &&
                ` Showing the ${SUGGESTIONS_PAGE} most recently seen; review or add rules to see the rest.`}
            </p>
            <SuggestionInbox
              slug={ctx.workspaceSlug}
              mode="review"
              suggestions={await listSuggestions(ctx)}
              canReview={canReview}
              confirmOne={confirmSuggestionAction.bind(null, ctx.workspaceSlug)}
              ignoreOne={ignoreSuggestionAction.bind(null, ctx.workspaceSlug)}
              confirmMany={confirmSuggestionsAction.bind(null, ctx.workspaceSlug)}
              ignoreMany={ignoreSuggestionsAction.bind(null, ctx.workspaceSlug)}
              createRule={createRuleAction.bind(null, ctx.workspaceSlug)}
            />
          </>
        )}
      </div>
    </>
  );
}
