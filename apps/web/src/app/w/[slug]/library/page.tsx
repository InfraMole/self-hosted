// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Plus, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { GettingStarted } from "@/components/resources/getting-started";
import { PageHeader } from "@/components/page-header";
import { LibraryFilters } from "@/components/resources/library-filters";
import { ResourceSheet } from "@/components/resources/resource-sheet";
import { ResourceTable } from "@/components/resources/resource-table";
import { RetireSourceBanner } from "@/components/resources/retire-source";
import { Button } from "@/components/ui/button";
import { hasRole } from "@/server/authz";
import { LIST_LIMIT, listResources } from "@/server/modules/resources/resources";
import { listSources } from "@/server/modules/resources/sources";
import { markStaleHosts } from "@/server/modules/discovery/staleness";
import { requireWorkspace } from "@/server/tenancy";
import { saveResourceAction } from "../resources/actions";
import { resolveTech } from "@/lib/tech";
import {
  archiveResourcesAction,
  deleteResourcesAction,
  retireSourceAction,
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
  const [resources, sources] = await Promise.all([listResources(ctx, filters), listSources(ctx)]);
  const canWrite = hasRole(ctx.role, "MEMBER");
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
        {resources.length === 0 && !filtered ? (
          <GettingStarted slug={ctx.workspaceSlug} role={ctx.role} addButton={addButton} />
        ) : (
          <>
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
                slug={ctx.workspaceSlug}
                canWrite={canWrite}
                archiveAction={archiveResourcesAction.bind(null, ctx.workspaceSlug)}
                deleteAction={deleteResourcesAction.bind(null, ctx.workspaceSlug)}
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
                  tech: resolveTech(r.tags, r.metadata.os),
                }))}
              />
            )}
            <p className="text-subtle text-xs">
              {resources.length} resource{resources.length === 1 ? "" : "s"}
              {resources.length >= LIST_LIMIT && ` (showing the first ${LIST_LIMIT})`}
            </p>
          </>
        )}
      </div>
    </>
  );
}
