// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { Network } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MapView } from "@/components/map/map-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { hasRole } from "@/server/authz";
import { getWorkspaceGraph } from "@/server/modules/map/map";
import { listSavedViews } from "@/server/modules/map/views";
import { requireWorkspace } from "@/server/tenancy";
import { deleteViewAction, saveViewAction, shareViewAction } from "./actions";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage({ params, searchParams }: PageProps<"/w/[slug]/map">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  const { focus, impact, view } = await searchParams;
  const [graph, views] = await Promise.all([getWorkspaceGraph(ctx), listSavedViews(ctx)]);
  // ?view= opens a saved view of this workspace; it wins over ?focus= / ?impact=.
  const initialViewId = typeof view === "string" && views.some((v) => v.id === view) ? view : null;
  // Only accept focus/impact ids that belong to this workspace graph.
  const inGraph = (v: unknown): v is string =>
    typeof v === "string" && graph.nodes.some((n) => n.id === v);
  const initialImpact = !initialViewId && inGraph(impact) ? impact : null;
  const initialFocus = !initialViewId && !initialImpact && inGraph(focus) ? focus : null;

  return (
    <>
      <PageHeader
        title="Map"
        description="Generated from your Library and relationships. Click a resource for details, double-click to focus."
      />
      {graph.nodes.length === 0 ? (
        <div className="flex-1 p-6">
          <EmptyState
            icon={Network}
            title="Nothing to map yet"
            description="The map draws itself from resources and their relationships. You never have to draw a diagram by hand."
          >
            <Button size="sm" asChild>
              <Link href={`/w/${ctx.workspaceSlug}/library`}>Go to Library</Link>
            </Button>
          </EmptyState>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <MapView
            workspaceSlug={ctx.workspaceSlug}
            workspaceName={ctx.workspaceName}
            nodes={graph.nodes}
            edges={graph.edges}
            initialFocus={initialFocus}
            initialImpact={initialImpact}
            views={views}
            initialViewId={initialViewId}
            canEditViews={hasRole(ctx.role, "MEMBER")}
            saveView={saveViewAction.bind(null, ctx.workspaceSlug)}
            deleteView={deleteViewAction.bind(null, ctx.workspaceSlug)}
            shareView={
              hasRole(ctx.role, "ADMIN") ? shareViewAction.bind(null, ctx.workspaceSlug) : undefined
            }
          />
        </div>
      )}
    </>
  );
}
