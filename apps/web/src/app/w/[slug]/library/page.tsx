// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Plus, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FirstSteps } from "@/components/onboarding/first-steps";
import { GettingStarted } from "@/components/resources/getting-started";
import { PageHeader } from "@/components/page-header";
import { LibraryFilters } from "@/components/resources/library-filters";
import { ResourceSheet } from "@/components/resources/resource-sheet";
import { ResourceTable } from "@/components/resources/resource-table";
import { RetireSourceBanner } from "@/components/resources/retire-source";
import { Button } from "@/components/ui/button";
import { hasRole } from "@/server/authz";
import {
  LIBRARY_SORTS,
  defaultDirection,
  listResourcesPage,
} from "@/server/modules/resources/resources";
import { listSources } from "@/server/modules/resources/sources";
import { markStaleHosts } from "@/server/modules/discovery/staleness";
import { getFirstStepsFacts } from "@/server/modules/workspaces/first-steps";
import { requireWorkspace } from "@/server/tenancy";
import { saveResourceAction } from "../resources/actions";
import { resolveTech } from "@/lib/tech";
import {
  archiveResourcesAction,
  deleteResourcesAction,
  retireSourceAction,
  setOwnerAction,
} from "../resources/bulk-actions";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/library">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  await markStaleHosts(ctx.workspaceId); // throttled (ADR-016)
  const filters = await searchParams;
  const [library, sources, firstSteps] = await Promise.all([
    listResourcesPage(ctx, filters),
    listSources(ctx),
    getFirstStepsFacts(ctx),
  ]);
  const resources = library.rows;
  const canWrite = hasRole(ctx.role, "MEMBER");
  /** The current URL with some parameters replaced (pagination links). */
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (typeof v === "string" && v) next.set(k, v);
    for (const [k, v] of Object.entries(changes))
      if (v === null) next.delete(k);
      else next.set(k, v);
    const qs = next.toString();
    return `/w/${ctx.workspaceSlug}/library${qs ? `?${qs}` : ""}`;
  };
  const filtered = ["q", "type", "environment", "status", "source"].some((k) => filters[k]);
  const activeSource = sources.find((s) => s.ref === filters.source);
  // Outcome of a retirement ("12.3" = deleted.archived): numbers only, nothing reflected.
  const retiredMatch =
    typeof filters.retired === "string" ? /^(\d{1,5})\.(\d{1,5})$/.exec(filters.retired) : null;
  const retired = retiredMatch
    ? { deleted: Number(retiredMatch[1]), archived: Number(retiredMatch[2]) }
    : null;
  const retirable =
    canWrite &&
    activeSource &&
    (activeSource.removed || activeSource.kind === "file") &&
    activeSource.total > activeSource.archived;

  const addButton = canWrite ? (
    <ResourceSheet
      mode="create"
      workspaceSlug={ctx.workspaceSlug}
      action={saveResourceAction.bind(null, ctx.workspaceSlug, null)}
      trigger={
        <Button size="sm">
          <Plus /> Add resource
        </Button>
      }
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="Library"
        description="Everything you run: servers, apps, databases, services."
        actions={
          canWrite ? (
            <>
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/w/${ctx.workspaceSlug}/library/import`}>
                  <FileUp /> Import
                </Link>
              </Button>
              {addButton}
            </>
          ) : null
        }
      />
      <div className="flex flex-1 flex-col gap-4 p-6">
        {library.total === 0 && !filtered ? (
          <GettingStarted slug={ctx.workspaceSlug} role={ctx.role} addButton={addButton} />
        ) : (
          <>
            <FirstSteps
              slug={ctx.workspaceSlug}
              facts={firstSteps}
              canAdd={{ sources: hasRole(ctx.role, "ADMIN"), import: canWrite }}
            />
            {retired && (
              <p
                role="status"
                className="border-border text-muted rounded-md border px-3 py-2 text-xs"
              >
                Retired: {retired.deleted} deleted
                {retired.archived > 0 &&
                  `, ${retired.archived} archived (they had human notes, edits or relationships)`}
                .
              </p>
            )}
            <LibraryFilters
              sources={sources.map(({ ref, label, removed }) => ({ ref, label, removed }))}
            />
            {retirable && activeSource && (
              <RetireSourceBanner
                label={activeSource.label}
                count={activeSource.total - activeSource.archived}
                removed={activeSource.removed}
                action={retireSourceAction.bind(null, ctx.workspaceSlug, activeSource.ref)}
              />
            )}
            {resources.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No matches"
                description="No resources match these filters."
              />
            ) : (
              <ResourceTable
                // A new page, sort or filter starts with nothing selected.
                key={`${library.page}|${library.sort}|${library.dir}|${["q", "type", "environment", "status", "source"].map((k) => filters[k] ?? "").join("|")}`}
                sort={{
                  sort: library.sort,
                  dir: library.dir,
                  defaults: Object.fromEntries(LIBRARY_SORTS.map((c) => [c, defaultDirection(c)])),
                }}
                slug={ctx.workspaceSlug}
                canWrite={canWrite}
                archiveAction={archiveResourcesAction.bind(null, ctx.workspaceSlug)}
                deleteAction={deleteResourcesAction.bind(null, ctx.workspaceSlug)}
                ownerAction={setOwnerAction.bind(null, ctx.workspaceSlug)}
                rows={resources.map((r) => ({
                  id: r.id,
                  name: r.name,
                  type: r.type,
                  environment: r.environment,
                  criticality: r.criticality,
                  status: r.status,
                  ips: r.metadata.ipAddresses ?? [],
                  updatedAt: r.updatedAt,
                  sourceLabel: r.sourceLabel,
                  owner: r.owner,
                  tech: resolveTech(r.tags, r.metadata.os),
                }))}
              />
            )}
            <nav
              aria-label="Pages"
              className="text-subtle flex flex-wrap items-center gap-3 text-xs"
            >
              <span>
                {library.total === 0
                  ? "0 resources"
                  : library.pages === 1
                    ? `${library.total} resource${library.total === 1 ? "" : "s"}`
                    : `${(library.page - 1) * library.pageSize + 1}–${Math.min(
                        library.page * library.pageSize,
                        library.total,
                      )} of ${library.total} resources`}
              </span>
              {library.pages > 1 && (
                <span className="flex items-center gap-1">
                  {library.page > 1 ? (
                    <Link
                      href={href({ page: library.page === 2 ? null : String(library.page - 1) })}
                      className="border-border hover:text-foreground rounded border px-2 py-0.5"
                    >
                      ← Previous
                    </Link>
                  ) : null}
                  <span className="px-1 font-mono">
                    {library.page} / {library.pages}
                  </span>
                  {library.page < library.pages ? (
                    <Link
                      href={href({ page: String(library.page + 1) })}
                      className="border-border hover:text-foreground rounded border px-2 py-0.5"
                    >
                      Next →
                    </Link>
                  ) : null}
                </span>
              )}
            </nav>
          </>
        )}
      </div>
    </>
  );
}
