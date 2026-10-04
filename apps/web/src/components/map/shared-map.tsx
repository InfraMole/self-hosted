// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import type { SavedViewState } from "@/lib/map-view-state";
import type { MapEdge, MapNode } from "@/server/modules/map/map";
import { MapView } from "./map-view";

const nothing = async () => ({ ok: false as const, error: "Read-only" });

/** The map of a public share link (M31): the view's subset, opened in its state, read-only. */
export function SharedMap({
  viewName,
  workspaceName,
  nodes,
  edges,
  state,
}: {
  viewName: string;
  workspaceName: string;
  nodes: MapNode[];
  edges: MapEdge[];
  state: SavedViewState;
}) {
  return (
    <MapView
      shared
      workspaceSlug=""
      workspaceName={workspaceName}
      nodes={nodes}
      edges={edges}
      initialFocus={null}
      initialImpact={null}
      views={[{ id: "shared", name: viewName, state, updatedAt: "" }]}
      initialViewId="shared"
      canEditViews={false}
      saveView={nothing}
      deleteView={nothing}
    />
  );
}
