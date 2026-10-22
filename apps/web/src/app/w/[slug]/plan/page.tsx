// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Network, ShieldCheck, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { CopyTextButton } from "@/components/impact/copy-text-button";
import { PlanEditor } from "@/components/plan/plan-editor";
import { PrintButton } from "@/components/plan/print-button";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { EnvironmentLabel, TypeIcon } from "@/components/resources/resource-badges";
import { Button } from "@/components/ui/button";
import {
  PLAN_TITLE_MAX,
  PLAN_WHEN_MAX,
  parseResourceIds,
  planNotify,
  planReportText,
  planText,
  rootsLabel,
  type PlanReport,
} from "@/lib/change-plan";
import { formatDateTime } from "@/lib/format";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { getChangeImpact, type ChangeAffectedView } from "@/server/modules/impact/impact";
import { requireWorkspace } from "@/server/tenancy";
import { searchResourcesAction } from "../search-actions";

export const metadata: Metadata = { title: "Plan a change" };

const typeLabel = (type: string) => RESOURCE_TYPES[type as keyof typeof RESOURCE_TYPES].label;

/**
 * Plan a change (M34, ADR-050): several resources changing together, what
 * could be affected and who to warn — a report for a change request. The
 * plan lives in the URL; nothing is stored.
 */
export default async function PlanPage({ params, searchParams }: PageProps<"/w/[slug]/plan">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const query = await searchParams;
  const ids = parseResourceIds(query.ids);
  const title = planText(query.title, PLAN_TITLE_MAX);
  const when = planText(query.when, PLAN_WHEN_MAX);
  const plan = await getChangeImpact(ctx, ids);
  const changedNames = plan.changed.map((r) => r.name);
  const generatedAt = new Date();

  const report: PlanReport = {
    workspace: ctx.workspaceName,
    title,
    when,
    generatedAt,
    changed: plan.changed.map((r) => ({
      name: r.name,
      typeLabel: typeLabel(r.type),
      owner: r.owner,
      ownerContact: r.ownerContact,
    })),
    affected: plan.affected.map((a) => ({
      name: a.resource.name,
      typeLabel: typeLabel(a.resource.type),
      owner: a.resource.owner,
      ownerContact: a.resource.ownerContact,
      confidence: a.confidence,
      depth: a.depth,
      causes: a.causeNames,
      pathNames: a.pathNames,
    })),
  };
  const notify = planNotify(report);
  const groups = new Map<string, ChangeAffectedView[]>();
  for (const a of plan.affected)
    groups.set(a.resource.type, [...(groups.get(a.resource.type) ?? []), a]);
  const many = plan.changed.length > 1;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Plan a change"
          description="Pick what you are going to change: see what could be affected and who to warn."
        />
      </div>
      <div className="flex max-w-5xl flex-col gap-6 p-6 print:max-w-none print:p-0">
        <PlanEditor
          slug={ctx.workspaceSlug}
          picks={plan.changed.map((r) => ({ id: r.id, name: r.name, type: r.type }))}
          title={title}
          when={when}
          search={searchResourcesAction.bind(null, ctx.workspaceSlug)}
        />
        {plan.missing > 0 && (
          <p className="text-muted text-xs print:hidden">
            {plan.missing} resource{plan.missing === 1 ? " in this link is" : "s in this link are"}{" "}
            not on this workspace&apos;s map (archived or deleted) and{" "}
            {plan.missing === 1 ? "was" : "were"} left out.
          </p>
        )}

        {plan.changed.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="What are you going to change?"
            description="Add the resources of a maintenance, a migration or a shutdown above — or select them in the Library and choose Plan a change. You get what could be affected, who to warn and a report for your change request."
          />
        ) : (
          <article aria-label="Change report" className="flex flex-col gap-6">
            <header className="border-border bg-surface rounded-lg border p-5 print:border-0 print:p-0">
              <p className="text-subtle text-[11px] font-medium tracking-wider uppercase">
                Change report · {ctx.workspaceName}
              </p>
              <h2 className="mt-1 text-lg font-medium">
                {title || `Change to ${rootsLabel(changedNames)}`}
              </h2>
              <p className="text-muted mt-0.5 text-xs">
                {when ? `${when} · ` : ""}Computed {formatDateTime(generatedAt)}
              </p>
              <p className="mt-3">
                If <span className="font-mono">{rootsLabel(changedNames)}</span>{" "}
                {many ? "stop" : "stops"} working,{" "}
                {plan.summary.total === 0 ? (
                  <>nothing recorded depends on {many ? "them" : "it"}.</>
                ) : (
                  <>
                    <span className="text-warning font-medium">{plan.summary.total}</span> other
                    resource{plan.summary.total === 1 ? "" : "s"} could be affected.
                  </>
                )}
              </p>
              {plan.summary.total > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {Object.entries(plan.summary.byType).map(([type, count]) => (
                    <span
                      key={type}
                      className="border-border-strong text-muted inline-flex h-6 items-center gap-1.5 rounded border px-2 text-xs"
                    >
                      <TypeIcon type={type as keyof typeof RESOURCE_TYPES} className="size-3.5" />
                      {typeLabel(type)}
                      <span className="text-foreground font-mono">{count}</span>
                    </span>
                  ))}
                  <span className="bg-border mx-1 h-4 w-px" aria-hidden />
                  {(["confirmed", "detected", "inferred"] as const)
                    .filter((c) => plan.summary.byConfidence[c] > 0)
                    .map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 text-xs">
                        <ConfidenceBadge confidence={c} />
                        <span className="font-mono">{plan.summary.byConfidence[c]}</span>
                      </span>
                    ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
                <CopyTextButton text={planReportText(report)} label="Copy report" />
                <PrintButton />
                <Button size="sm" variant="secondary" asChild>
                  <Link
                    href={`/w/${ctx.workspaceSlug}/map?impact=${plan.changed.map((r) => r.id).join(",")}`}
                  >
                    <Network /> Show on map
                  </Link>
                </Button>
              </div>
            </header>

            <section>
              <h3 className="mb-2 text-sm font-medium">
                In this change{" "}
                <span className="text-subtle font-mono text-xs">{plan.changed.length}</span>
              </h3>
              <ul className="border-border divide-border divide-y rounded-lg border">
                {plan.changed.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <Link
                      href={`/w/${ctx.workspaceSlug}/resources/${r.id}`}
                      className="hover:text-accent flex w-56 shrink-0 items-center gap-2 font-mono text-[13px]"
                    >
                      <TypeIcon type={r.type} />
                      <span className="truncate">{r.name}</span>
                    </Link>
                    <span className="text-muted w-28 shrink-0 text-xs">{typeLabel(r.type)}</span>
                    <span className="text-muted hidden w-28 shrink-0 text-xs md:inline print:inline">
                      <EnvironmentLabel environment={r.environment} />
                    </span>
                    <span className="text-muted min-w-0 flex-1 truncate text-xs">
                      {r.owner ? `Owner: ${r.owner}` : "No owner recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {(notify.groups.length > 0 || notify.unowned.length > 0) && (
              <section
                aria-label="Who to warn"
                className="border-border bg-surface rounded-lg border p-4 print:break-inside-avoid"
              >
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <Users className="text-muted size-4" /> Who to warn
                </h3>
                {notify.groups.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    {notify.groups.map((g) => (
                      <li key={g.owner}>
                        <span className="font-medium">{g.owner}</span>
                        {g.contact && <span className="text-muted"> · {g.contact}</span>}
                        <span className="text-muted"> — </span>
                        <span className="font-mono text-xs">
                          {g.resources.map((r) => r.name).join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted mt-2 text-sm">
                    None of these resources has an owner yet. Add one with <em>Edit</em> on a
                    resource.
                  </p>
                )}
                {notify.groups.length > 0 && notify.unowned.length > 0 && (
                  <p className="text-subtle mt-3 text-xs">
                    No owner recorded for {notify.unowned.length}:{" "}
                    <span className="font-mono">{notify.unowned.join(", ")}</span>
                  </p>
                )}
              </section>
            )}

            {plan.summary.total === 0 ? (
              <div className="border-border text-muted flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
                <ShieldCheck className="text-subtle mt-0.5 size-4 shrink-0" />
                <p>
                  No recorded relationship says that anything else depends on{" "}
                  {many ? "these resources" : <span className="font-mono">{changedNames[0]}</span>}.
                  That does not prove nothing does — add relationships, or let an agent discover
                  connections.
                </p>
              </div>
            ) : (
              [...groups.entries()].map(([type, items]) => (
                <section key={type} className="print:break-inside-avoid">
                  <h3 className="mb-2 text-sm font-medium">
                    Could be affected · {typeLabel(type)}{" "}
                    <span className="text-subtle font-mono text-xs">{items.length}</span>
                  </h3>
                  <ul className="border-border divide-border divide-y rounded-lg border">
                    {items.map((a) => (
                      <li key={a.resourceId} className="flex items-center gap-3 px-3 py-2">
                        <Link
                          href={`/w/${ctx.workspaceSlug}/resources/${a.resourceId}/impact`}
                          className="hover:text-accent flex w-48 shrink-0 items-center gap-2 font-mono text-[13px]"
                        >
                          <TypeIcon type={a.resource.type} />
                          <span className="truncate">{a.resource.name}</span>
                        </Link>
                        <span
                          className="text-subtle min-w-0 flex-1 truncate font-mono text-xs"
                          title={a.pathNames.join(" → ")}
                        >
                          {a.depth === 1
                            ? `direct, from ${a.pathNames[0]}`
                            : `via ${a.pathNames.slice(1, -1).join(" → ")}`}
                          {many && a.causeNames.length > 1 && (
                            <span className="text-muted">
                              {" "}
                              · reached from {rootsLabel(a.causeNames)}
                            </span>
                          )}
                        </span>
                        <span className="text-muted shrink-0 font-mono text-xs">
                          {a.depth} hop{a.depth === 1 ? "" : "s"}
                        </span>
                        <ConfidenceBadge confidence={a.confidence} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}

            <p className="text-subtle text-xs leading-relaxed">
              Computed from recorded relationships that propagate failure. Informational links
              (monitoring, backups) are not included. A <em>detected</em> or <em>inferred</em>{" "}
              relationship is a lead to verify, not proof that a failure will propagate.
            </p>
          </article>
        )}
      </div>
    </>
  );
}
