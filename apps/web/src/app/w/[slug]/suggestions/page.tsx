// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { RELATIONSHIP_TYPE_INFO, edgeConfidence } from "@depmap/graph";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { TypeIcon } from "@/components/resources/resource-badges";
import { SuggestionActions } from "@/components/suggestions/suggestion-actions";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { hasRole } from "@/server/authz";
import { listSuggestions } from "@/server/modules/discovery/discovery";
import { requireWorkspace } from "@/server/tenancy";
import { confirmSuggestionAction, ignoreSuggestionAction } from "./actions";

export const metadata: Metadata = { title: "Suggestions" };

export default async function SuggestionsPage({ params }: PageProps<"/w/[slug]/suggestions">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const suggestions = await listSuggestions(ctx);
  const canReview = hasRole(ctx.role, "MEMBER");
  const base = `/w/${ctx.workspaceSlug}`;

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="Relationships detected by agents. Nothing becomes a dependency until you confirm it."
      />
      <div className="flex max-w-5xl flex-1 flex-col gap-3 p-6">
        {suggestions.length === 0 ? (
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
              {suggestions.length} to review · detected connections are leads, not proof of a
              dependency.
            </p>
            <ul className="flex flex-col gap-3">
              {suggestions.map((s) => {
                const e = s.evidence;
                return (
                  <li
                    key={s.id}
                    id={s.id}
                    className="border-border bg-surface rounded-lg border border-dashed px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`${base}/resources/${s.from.id}/dependencies`}
                        className="hover:text-accent flex items-center gap-2 font-mono text-sm"
                      >
                        <TypeIcon type={s.from.type} />
                        {s.from.name}
                      </Link>
                      <span className="text-muted flex items-center gap-1.5 text-xs">
                        {RELATIONSHIP_TYPE_INFO[s.type].label}
                        <ArrowRight className="size-3.5" />
                      </span>
                      <Link
                        href={`${base}/resources/${s.to.id}/dependencies`}
                        className="hover:text-accent flex items-center gap-2 font-mono text-sm"
                      >
                        <TypeIcon type={s.to.type} />
                        {s.to.name}
                      </Link>
                      <span className="ml-auto">
                        <ConfidenceBadge confidence={edgeConfidence("UNCONFIRMED", s.origin)!} />
                      </span>
                    </div>
                    <p className="text-muted mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                      {e.ports.length > 0 && <span>port {e.ports.join(", ")}</span>}
                      {e.protocols.length > 0 && (
                        <span className="font-sans">likely {e.protocols.join(" / ")}</span>
                      )}
                      {e.processes.length > 0 && <span>{e.processes.slice(0, 3).join(", ")}</span>}
                      <span>{e.samples} samples</span>
                      {e.lastSeenAt && (
                        <span className="font-sans" title={formatDateTime(e.lastSeenAt)}>
                          last seen {formatRelative(e.lastSeenAt)}
                        </span>
                      )}
                    </p>
                    {s.note && <p className="text-subtle mt-1 text-xs">{s.note}</p>}
                    {canReview && (
                      <div className="mt-3">
                        <SuggestionActions
                          fromName={s.from.name}
                          toName={s.to.name}
                          currentType={s.type}
                          suggestedType={e.suggestedType}
                          confirm={confirmSuggestionAction.bind(null, ctx.workspaceSlug, s.id)}
                          ignore={ignoreSuggestionAction.bind(null, ctx.workspaceSlug, s.id)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
