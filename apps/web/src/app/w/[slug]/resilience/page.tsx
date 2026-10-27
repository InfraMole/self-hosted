// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Layers, ShieldCheck, Users } from "lucide-react";
import { ZodError } from "zod";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/plan/print-button";
import { RankingTable, type RankingRow } from "@/components/resilience/ranking-table";
import { ResilienceFilters } from "@/components/resilience/resilience-filters";
import { CriticalityLabel, TypeIcon } from "@/components/resources/resource-badges";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { notifyList } from "@/lib/notify";
import { ENVIRONMENTS, RESOURCE_TYPES } from "@/lib/resource-presentation";
import { listSavedViews } from "@/server/modules/map/views";
import {
  RESILIENCE_LIMIT,
  ResilienceViewError,
  getResilience,
  type Resilience,
  type ResilienceConfidence,
} from "@/server/modules/resilience/resilience";
import { requireWorkspace } from "@/server/tenancy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Resilience" };

const COUNTED: Record<ResilienceConfidence, string> = {
  confirmed: "confirmed relationships only",
  detected: "confirmed and detected relationships",
  all: "confirmed, detected and inferred relationships",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Resilience report (M44, ADR-060): which resources could affect the most,
 * which have no redundancy, and in what order to bring things back. Computed
 * on request from recorded relationships; nothing is stored.
 */
export default async function ResiliencePage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/resilience">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const query = await searchParams;
  const views = await listSavedViews(ctx);

  let report: Resilience | null = null;
  let problem: string | null = null;
  try {
    report = await getResilience(ctx, {
      environment: one(query.environment),
      view: one(query.view),
      confidence: one(query.confidence),
    });
  } catch (error) {
    if (error instanceof ResilienceViewError) problem = error.message;
    else if (error instanceof ZodError) problem = "This link has a filter we do not understand.";
    else throw error;
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Resilience"
          description="What could affect the most, what has no known redundancy, and in what order to bring things back."
        />
      </div>
      <div className="flex max-w-6xl flex-col gap-6 p-6 print:max-w-none print:p-0">
        <ResilienceFilters views={views.map((v) => ({ id: v.id, name: v.name }))} />
        {problem || !report ? (
          <EmptyState
            icon={CircleAlert}
            title="Nothing to show for this scope"
            description={problem ?? "Pick another scope above."}
          >
            <Link href={`/w/${ctx.workspaceSlug}/resilience`} className="text-accent text-sm">
              Show the whole map
            </Link>
          </EmptyState>
        ) : report.resources === 0 ? (
          <EmptyState
            icon={Layers}
            title="No resources in this scope"
            description="Add resources in the Library, or pick another environment or saved view above."
          />
        ) : report.tooLarge ? (
          <EmptyState
            icon={Layers}
            title="Too many resources for one report"
            description={`This scope has ${report.resources.toLocaleString("en")} resources; the report computes up to ${RESILIENCE_LIMIT.toLocaleString("en")}. Pick an environment or a saved view above.`}
          />
        ) : (
          <Report slug={ctx.workspaceSlug} workspace={ctx.workspaceName} report={report} />
        )}
      </div>
    </>
  );
}

function scopeLabel(scope: Resilience["scope"]) {
  const parts = [
    scope.view ? `View “${scope.view.name}”` : "Whole map",
    scope.environment ? ENVIRONMENTS[scope.environment].label : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function Report({
  slug,
  workspace,
  report,
}: {
  slug: string;
  workspace: string;
  report: Resilience;
}) {
  const singleIds = new Set(report.singlePoints.map((r) => r.resource.id));
  const rows: RankingRow[] = report.ranking.map((r) => ({
    id: r.resource.id,
    name: r.resource.name,
    type: r.resource.type,
    couldAffect: r.couldAffect,
    confirmed: r.byConfidence.confirmed,
    covered: r.covered,
    dependsOn: r.dependsOn,
    criticality: r.resource.criticality,
    owner: r.resource.owner,
    singlePoint: singleIds.has(r.resource.id),
  }));
  const impactRows = rows.filter((r) => r.couldAffect > 0 || r.covered > 0);
  const dependencyRows = rows.filter((r) => r.dependsOn > 0);
  const top = report.ranking[0];
  const notify = notifyList(
    report.singlePoints.map((r) => ({
      name: r.resource.name,
      owner: r.resource.owner,
      ownerContact: r.resource.ownerContact,
    })),
  );
  const { waves, unconnected } = report.recovery;

  return (
    <article aria-label="Resilience report" className="flex flex-col gap-6">
      <header className="border-border bg-surface rounded-lg border p-5 print:border-0 print:p-0">
        <p className="text-subtle text-[11px] font-medium tracking-wider uppercase">
          Resilience report · {workspace}
        </p>
        <h2 className="mt-1 text-lg font-medium">{scopeLabel(report.scope)}</h2>
        <p className="text-muted mt-0.5 text-xs">
          {report.resources} resource{report.resources === 1 ? "" : "s"}, {report.relationships}{" "}
          relationship{report.relationships === 1 ? "" : "s"} · counting{" "}
          {COUNTED[report.scope.confidence]} · Computed {formatDateTime(new Date())}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Single points of failure"
            value={report.singlePoints.length}
            warn={report.singlePoints.length > 0}
          />
          <Stat
            label="Could affect the most"
            value={top && top.couldAffect > 0 ? top.resource.name : "—"}
            mono
          />
          <Stat label="Recovery waves" value={waves.length} />
          <Stat label="Not connected" value={unconnected.length} />
        </dl>
        {report.unreviewed > 0 && (
          <p className="text-warning mt-4 text-xs">
            {report.unreviewed} relationship{report.unreviewed === 1 ? " is" : "s are"} not reviewed
            yet: the numbers can change when {report.unreviewed === 1 ? "it is" : "they are"}.{" "}
            <Link href={`/w/${slug}/suggestions`} className="underline print:hidden">
              Review suggestions
            </Link>
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
          <PrintButton />
        </div>
      </header>

      <section aria-label="Single points of failure" className="print:break-inside-avoid">
        <h3 className="mb-1 text-sm font-medium">
          Single points of failure{" "}
          <span className="text-subtle font-mono text-xs">{report.singlePoints.length}</span>
        </h3>
        <p className="text-muted mb-2 text-xs">
          Resources that could affect others and have no known redundancy: they are not in a
          redundancy group. A redundancy group you declare on a resource changes this list.
        </p>
        {report.singlePoints.length === 0 ? (
          <div className="border-border text-muted flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
            <ShieldCheck className="text-subtle mt-0.5 size-4 shrink-0" />
            <p>
              {impactRows.length === 0
                ? "No recorded relationship in this scope propagates failure, so nothing here could affect anything else. That does not prove nothing does — add relationships, or let an agent discover connections."
                : "Every resource that could affect others in this scope is in a redundancy group."}
            </p>
          </div>
        ) : (
          <ul className="border-border divide-border divide-y rounded-lg border">
            {report.singlePoints.map((r) => (
              <li key={r.resource.id} className="flex items-center gap-3 px-3 py-2">
                <Link
                  href={`/w/${slug}/resources/${r.resource.id}/impact`}
                  className="hover:text-accent flex w-56 shrink-0 items-center gap-2 font-mono text-[13px]"
                >
                  <TypeIcon type={r.resource.type} />
                  <span className="truncate">{r.resource.name}</span>
                </Link>
                <span className="text-muted hidden w-28 shrink-0 text-xs sm:inline print:inline">
                  {RESOURCE_TYPES[r.resource.type].label}
                </span>
                <span className="min-w-0 flex-1 text-xs">
                  could affect{" "}
                  <span className="text-warning font-mono font-medium">{r.couldAffect}</span>
                </span>
                <span className="hidden w-24 shrink-0 text-xs md:inline print:inline">
                  <CriticalityLabel criticality={r.resource.criticality} />
                </span>
                <span className="text-muted hidden w-40 shrink-0 truncate text-xs md:inline print:inline">
                  {r.resource.owner ?? "No owner recorded"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(notify.groups.length > 0 || notify.unowned.length > 0) && (
        <section
          aria-label="Who to talk to"
          className="border-border bg-surface rounded-lg border p-4 print:break-inside-avoid"
        >
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Users className="text-muted size-4" /> Who to talk to about them
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
              None of them has an owner yet. Add one with <em>Edit</em> on a resource.
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

      {impactRows.length > 0 && (
        <section aria-label="Most impact">
          <h3 className="mb-1 text-sm font-medium">Could affect the most</h3>
          <p className="text-muted mb-2 text-xs">
            How many resources could be affected if each one stops working. Criticality is what you
            set; it is shown beside the numbers, not mixed into them.
          </p>
          <RankingTable
            slug={slug}
            rows={impactRows}
            initialSort="couldAffect"
            label="Most impact"
          />
        </section>
      )}

      {dependencyRows.length > 0 && (
        <section aria-label="Most dependencies">
          <h3 className="mb-1 text-sm font-medium">Depend on the most</h3>
          <p className="text-muted mb-2 text-xs">
            How many resources could affect each one if they stopped working.
          </p>
          <RankingTable
            slug={slug}
            rows={dependencyRows}
            initialSort="dependsOn"
            label="Most dependencies"
          />
        </section>
      )}

      {waves.length > 0 && (
        <section aria-label="Recovery order">
          <h3 className="mb-1 text-sm font-medium">Recovery order</h3>
          <p className="text-muted mb-2 text-xs">
            If everything here went down: bring back each wave before the next. Resources in the
            same wave do not depend on each other.
          </p>
          <ol className="border-border divide-border divide-y rounded-lg border">
            {waves.map((wave, i) => (
              <li key={i} className="flex gap-4 px-3 py-2.5 print:break-inside-avoid">
                <span className="text-subtle w-16 shrink-0 pt-0.5 text-xs">Wave {i + 1}</span>
                <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1.5">
                  {wave.map((step) => (
                    <li
                      key={step.resources[0]!.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      {step.resources.map((r) => (
                        <Link
                          key={r.id}
                          href={`/w/${slug}/resources/${r.id}`}
                          className="hover:text-accent inline-flex items-center gap-1.5 font-mono text-[13px]"
                        >
                          <TypeIcon type={r.type} className="size-3.5" />
                          {r.name}
                        </Link>
                      ))}
                      {step.groupName && (
                        <Badge title="Redundancy group: its members come back together">
                          group {step.groupName}
                        </Badge>
                      )}
                      {step.circular && (
                        <Badge
                          className="text-warning"
                          title="These depend on each other in a circle: the order between them is unknown"
                        >
                          circular
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {unconnected.length > 0 && (
            <p className="text-subtle mt-2 text-xs">
              Not connected by anything that propagates failure — any order:{" "}
              <span className="font-mono">{unconnected.map((r) => r.name).join(", ")}</span>
            </p>
          )}
        </section>
      )}

      <p className="text-subtle text-xs leading-relaxed">
        Computed from recorded relationships that propagate failure, up to the same depth as the
        impact page. Informational links (monitoring, backups) are not included. A <em>detected</em>{" "}
        or <em>inferred</em> relationship is a lead to verify, not proof that a failure will
        propagate. Nothing recorded does not mean nothing depends on a resource.
      </p>
    </article>
  );
}

function Stat({
  label,
  value,
  warn,
  mono,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-subtle text-[11px] tracking-wider uppercase">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-lg",
          warn && "text-warning",
          (mono || typeof value === "number") && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
