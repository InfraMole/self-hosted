// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Confidence } from "@depmap/graph";
import { TypeIcon } from "@/components/resources/resource-badges";
import { ENVIRONMENTS } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";
import type { MapNode } from "@/server/modules/map/map";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

export type ImpactLevel = "root" | Confidence;

export type ResourceFlowNode = Node<
  { resource: MapNode; dimmed: boolean; isFocus: boolean; impact: ImpactLevel | null },
  "resource"
>;

/** Same encoding as ConfidenceBadge / edges: solid · dashed · dotted. */
const IMPACT_BORDER: Record<ImpactLevel, string> = {
  root: "border-danger ring-2 ring-danger/30",
  confirmed: "border-warning",
  detected: "border-warning border-dashed",
  inferred: "border-muted border-dotted",
};

const CRITICALITY_BAR: Record<string, string> = {
  CRITICAL: "bg-danger",
  HIGH: "bg-warning",
};

function ResourceNodeImpl({ data, selected }: NodeProps<ResourceFlowNode>) {
  const r = data.resource;
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        "bg-surface relative flex items-center gap-2 overflow-hidden rounded-md border px-2.5 transition-opacity",
        selected
          ? "border-accent ring-accent/25 ring-2"
          : data.impact
            ? IMPACT_BORDER[data.impact]
            : data.isFocus
              ? "border-accent/70"
              : "border-border-strong hover:border-muted",
        data.dimmed && "opacity-30",
      )}
      title={r.name}
    >
      {r.criticality && CRITICALITY_BAR[r.criticality] && (
        <span
          className={cn("absolute inset-y-0 left-0 w-0.5", CRITICALITY_BAR[r.criticality])}
          aria-hidden
        />
      )}
      <Handle type="target" position={Position.Top} isConnectable={false} className="!opacity-0" />
      <TypeIcon type={r.type} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.name}</span>
      {r.environment && (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", ENVIRONMENTS[r.environment].dot)}
          title={ENVIRONMENTS[r.environment].label}
        />
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!opacity-0"
      />
    </div>
  );
}

export const ResourceNode = memo(ResourceNodeImpl);
