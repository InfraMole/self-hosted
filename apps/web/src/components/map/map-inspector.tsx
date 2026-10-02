// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { Crosshair, ExternalLink, Radar, X } from "lucide-react";
import { perspective, type Bucket, type Confidence } from "@depmap/graph";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import {
  CriticalityLabel,
  EnvironmentLabel,
  TypeIcon,
} from "@/components/resources/resource-badges";
import { Button } from "@/components/ui/button";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import type { MapEdge, MapNode } from "@/server/modules/map/map";

interface Props {
  workspaceSlug: string;
  resource: MapNode;
  edges: MapEdge[];
  byId: Map<string, MapNode>;
  isFocus: boolean;
  isImpactRoot: boolean;
  /** Present when this resource could be affected in the current impact view. */
  impactInfo?: { confidence: Confidence; depth: number; pathNames: string[] };
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onImpact: (id: string) => void;
  onClose: () => void;
  /** Collapsed box: what it contains and the relationships inside it. */
  inside?: { resources: MapNode[]; relationships: string[] };
}

const SECTIONS: { bucket: Bucket; title: string }[] = [
  { bucket: "dependsOn", title: "Depends on" },
  { bucket: "usedBy", title: "Used by" },
  { bucket: "related", title: "Related" },
];

export function MapInspector({
  workspaceSlug,
  resource: r,
  edges,
  byId,
  isFocus,
  isImpactRoot,
  impactInfo,
  onSelect,
  onFocus,
  onImpact,
  onClose,
  inside,
}: Props) {
  const rows: Record<
    Bucket,
    { id: string; name: string; phrase: string; type: MapNode["type"] }[]
  > = { dependsOn: [], usedBy: [], related: [] };
  for (const e of edges) {
    if (e.from !== r.id && e.to !== r.id) continue;
    const p = perspective(e, r.id);
    const other = byId.get(p.otherId);
    if (other)
      rows[p.bucket].push({ id: other.id, name: other.name, phrase: p.phrase, type: other.type });
  }

  return (
    <aside
      className="border-border bg-surface flex w-80 shrink-0 flex-col border-l"
      aria-label={`${r.name} details`}
    >
      <div className="border-border flex items-start gap-3 border-b px-4 py-3">
        <div className="border-border-strong bg-surface-2 flex size-8 shrink-0 items-center justify-center rounded-md border">
          <TypeIcon type={r.type} tech={r.tech} className="text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-medium">{r.name}</p>
          <p className="text-muted text-xs">{RESOURCE_TYPES[r.type].label}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted">Environment</dt>
          <dd>
            <EnvironmentLabel environment={r.environment} />
          </dd>
          <dt className="text-muted">Criticality</dt>
          <dd>
            <CriticalityLabel criticality={r.criticality} />
          </dd>
          {r.owner && (
            <>
              <dt className="text-muted">Owner</dt>
              <dd>
                {r.owner}
                {r.ownerContact && (
                  <span className="text-muted block break-all">{r.ownerContact}</span>
                )}
              </dd>
            </>
          )}
          {r.ipAddresses.length > 0 && (
            <>
              <dt className="text-muted">IPs</dt>
              <dd className="font-mono">{r.ipAddresses.join(", ")}</dd>
            </>
          )}
        </dl>

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" asChild className="flex-1">
            <Link href={`/w/${workspaceSlug}/resources/${r.id}`}>
              <ExternalLink /> Open
            </Link>
          </Button>
          <Button
            size="sm"
            variant={isFocus ? "outline" : "secondary"}
            onClick={() => onFocus(r.id)}
            disabled={isFocus}
            className="flex-1"
          >
            <Crosshair /> {isFocus ? "Focused" : "Focus"}
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onImpact(r.id)}
          disabled={isImpactRoot}
          className="w-full"
        >
          <Radar /> {isImpactRoot ? "Showing impact" : "Impact — what could be affected?"}
        </Button>

        {impactInfo && (
          <div className="border-warning/40 bg-surface-2 rounded-md border px-3 py-2.5">
            <p className="text-warning text-xs font-medium">Could be affected</p>
            <p className="text-muted mt-1 flex items-center gap-2 text-xs">
              <ConfidenceBadge confidence={impactInfo.confidence} />
              {impactInfo.depth} hop{impactInfo.depth === 1 ? "" : "s"}
            </p>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed break-words">
              {impactInfo.pathNames.join(" → ")}
            </p>
          </div>
        )}

        {SECTIONS.map(({ bucket, title }) => (
          <section key={bucket}>
            <h3 className="text-subtle mb-1.5 text-[11px] font-medium tracking-wider uppercase">
              {title} <span className="font-mono">{rows[bucket].length}</span>
            </h3>
            {rows[bucket].length === 0 ? (
              <p className="text-subtle text-xs">—</p>
            ) : (
              <ul className="space-y-0.5">
                {rows[bucket].map((row) => (
                  <li key={`${row.id}-${row.phrase}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(row.id)}
                      className="hover:bg-surface-2 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
                    >
                      <TypeIcon type={row.type} className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.name}</span>
                      <span className="text-subtle shrink-0 text-[11px]">{row.phrase}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {inside && (
          <section>
            <h3 className="text-subtle mb-1.5 text-[11px] font-medium tracking-wider uppercase">
              Inside (collapsed) <span className="font-mono">{inside.resources.length}</span>
            </h3>
            <ul className="space-y-0.5">
              {inside.resources.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(child.id)}
                    className="hover:bg-surface-2 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left"
                  >
                    <TypeIcon type={child.type} tech={child.tech} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{child.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {inside.relationships.length > 0 && (
              <>
                <p className="text-subtle mt-2 mb-1 text-[11px]">
                  Relationships between them (not drawn while collapsed):
                </p>
                <ul className="text-muted space-y-0.5 text-xs">
                  {inside.relationships.map((text) => (
                    <li key={text} className="px-1.5">
                      {text}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
