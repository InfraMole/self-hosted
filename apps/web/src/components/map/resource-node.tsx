// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Minus, Plus } from "lucide-react";
import type { Confidence } from "@depmap/graph";
import { TypeIcon } from "@/components/resources/resource-badges";
import { ENVIRONMENTS } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";
import type { MapNode } from "@/server/modules/map/map";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

export type ImpactLevel = "root" | Confidence;

export interface ResourceNodeData extends Record<string, unknown> {
  resource: MapNode;
  dimmed: boolean;
  isFocus: boolean;
  impact: ImpactLevel | null;
  /** Collapsed group: how many resources it contains (M26). */
  hidden?: number;
  /** Expand / collapse this group. */
  onToggle?: (id: string) => void;
}

export type ResourceFlowNode = Node<ResourceNodeData, "resource" | "box">;

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

/** Both sides can send and receive: edges leave and enter on the facing sides. */
function Handles() {
  return (
    <>
      <Handle
        id="top-in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!opacity-0"
      />
      <Handle
        id="top-out"
        type="source"
        position={Position.Top}
        isConnectable={false}
        className="!opacity-0"
      />
      <Handle
        id="bottom-in"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className="!opacity-0"
      />
      <Handle
        id="bottom-out"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!opacity-0"
      />
    </>
  );
}

function borderClass(data: ResourceNodeData, selected: boolean | undefined) {
  return selected
    ? "border-accent ring-accent/25 ring-2"
    : data.impact
      ? IMPACT_BORDER[data.impact]
      : data.isFocus
        ? "border-accent/70"
        : "border-border-strong hover:border-muted";
}

/** Name row shared by plain nodes and group headers. */
function Header({ id, data }: { id: string; data: ResourceNodeData }) {
  const r = data.resource;
  const expanded = data.hidden === undefined && data.onToggle !== undefined;
  return (
    <>
      <TypeIcon type={r.type} tech={r.tech} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.name}</span>
      {r.environment && (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", ENVIRONMENTS[r.environment].dot)}
          title={ENVIRONMENTS[r.environment].label}
        />
      )}
      {data.onToggle && (
        <button
          type="button"
          // Not a drag handle, and not a node click (selection).
          className="nodrag border-border-strong text-muted hover:text-foreground hover:border-muted inline-flex h-5 shrink-0 items-center gap-0.5 rounded border px-1 font-mono text-[10px]"
          onClick={(event) => {
            event.stopPropagation();
            data.onToggle!(id);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          title={expanded ? "Collapse what runs on it" : "Show what runs on it"}
          aria-label={expanded ? `Collapse ${r.name}` : `Expand ${r.name}`}
        >
          {expanded ? <Minus className="size-3" /> : <Plus className="size-3" />}
          {!expanded && data.hidden}
        </button>
      )}
    </>
  );
}

function ResourceNodeImpl({ id, data, selected }: NodeProps<ResourceFlowNode>) {
  const r = data.resource;
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        "bg-surface relative flex items-center gap-2 overflow-hidden rounded-md border px-2.5 transition-opacity",
        borderClass(data, selected),
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
      <Handles />
      <Header id={id} data={data} />
    </div>
  );
}

/** An expanded group (M26): the resource as a box around what runs on it. */
function GroupNodeImpl({ id, data, selected, width, height }: NodeProps<ResourceFlowNode>) {
  const r = data.resource;
  return (
    <div
      style={{ width, height }}
      className={cn(
        "bg-surface/40 relative rounded-lg border transition-opacity",
        borderClass(data, selected),
        data.dimmed && "opacity-40",
      )}
    >
      {r.criticality && CRITICALITY_BAR[r.criticality] && (
        <span
          className={cn(
            "absolute top-0 left-0 h-10 w-0.5 rounded-tl-lg",
            CRITICALITY_BAR[r.criticality],
          )}
          aria-hidden
        />
      )}
      <Handles />
      <div
        className="border-border bg-surface flex items-center gap-2 rounded-t-lg border-b px-2.5"
        style={{ height: NODE_HEIGHT }}
        title={r.name}
      >
        <Header id={id} data={data} />
      </div>
    </div>
  );
}

export const ResourceNode = memo(ResourceNodeImpl);
export const GroupNode = memo(GroupNodeImpl);
