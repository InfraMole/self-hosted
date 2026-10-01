// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Edge,
} from "@xyflow/react";
import { Crosshair, Download, Radar, X } from "lucide-react";
import {
  RELATIONSHIP_TYPE_INFO,
  dependencyDirection,
  edgeConfidence,
  impact,
  neighbourhood,
  perspective,
  type Direction,
} from "@depmap/graph";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { Select } from "@/components/ui/select";
import { ENVIRONMENTS, RESOURCE_TYPES, entries } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";
import { buildScene, exportFileName, type ExportImpact } from "@/lib/map-export/scene";
import type { MapEdge, MapNode } from "@/server/modules/map/map";
import { downloadPdf, downloadPng } from "./export-map";
import {
  DETAILED_LAYOUT_LIMIT,
  NODE_HEIGHT,
  NODE_WIDTH,
  drawDirection,
  stackLayout,
} from "./layout";
import { MapInspector } from "./map-inspector";
import { ResourceNode, type ImpactLevel, type ResourceFlowNode } from "./resource-node";

/** Below this zoom node names are unreadable: large maps open on their main group instead. */
const READABLE_ZOOM = 0.55;

/** Literal colours: SVG markers cannot use CSS variables reliably. Dark theme (docs/UI.md). */
const COLORS = {
  edge: "#6b737d",
  informational: "#3b434c",
  highlight: "#45d0bd",
  impact: "#f0b43c",
  label: "#e5e8eb",
};
const ENV_HEX: Record<string, string> = {
  PRODUCTION: "#f2706a",
  STAGING: "#f0b43c",
  DEVELOPMENT: "#6fa6f7",
  TEST: "#a48cf5",
  OTHER: "#5a626c",
};
const nodeTypes = { resource: ResourceNode };

export interface Focus {
  id: string;
  depth: number;
  direction: Direction;
}

interface Props {
  workspaceSlug: string;
  workspaceName: string;
  nodes: MapNode[];
  edges: MapEdge[];
  initialFocus: string | null;
  initialImpact: string | null;
}

export function MapView(props: Props) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MapCanvas({
  workspaceSlug,
  workspaceName,
  nodes,
  edges,
  initialFocus,
  initialImpact,
}: Props) {
  const { fitView, setViewport } = useReactFlow();
  const store = useStoreApi();
  const [typeFilter, setTypeFilter] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [showUnconfirmed, setShowUnconfirmed] = useState(false);
  const [showInformational, setShowInformational] = useState(true);
  const [focus, setFocus] = useState<Focus | null>(
    initialFocus ? { id: initialFocus, depth: 2, direction: "both" } : null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialImpact ?? initialFocus);
  // Impact mode: show only the failing resource and what could be affected (M4).
  const [impactId, setImpactId] = useState<string | null>(initialImpact);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const impactResult = useMemo(() => {
    if (!impactId || !byId.has(impactId)) return null;
    const impactEdges = edges.map((e) => ({
      ...e,
      confidence: edgeConfidence(e.status, e.origin),
    }));
    return impact(impactEdges, impactId);
  }, [impactId, edges, byId]);

  const impactLevels = useMemo(() => {
    if (!impactResult) return null;
    const levels = new Map<string, ImpactLevel>([[impactResult.rootId, "root"]]);
    for (const a of impactResult.affected) levels.set(a.resourceId, a.confidence);
    return levels;
  }, [impactResult]);

  const impactEdgeIds = useMemo(
    () => new Set(impactResult?.affected.flatMap((a) => a.viaEdges) ?? []),
    [impactResult],
  );

  // Edges allowed by the confidence / informational toggles.
  const candidateEdges = useMemo(
    () =>
      edges.filter((e) => {
        const confidence = edgeConfidence(e.status, e.origin);
        if (!confidence) return false;
        // Impact mode shows every propagating edge (confidence is drawn, not filtered).
        if (impactLevels) return dependencyDirection(e) !== null;
        if (confidence !== "confirmed" && !showUnconfirmed) return false;
        if (!showInformational && dependencyDirection(e) === null) return false;
        return true;
      }),
    [edges, showUnconfirmed, showInformational, impactLevels],
  );

  const visibleIds = useMemo(() => {
    if (impactLevels) return nodes.filter((n) => impactLevels.has(n.id)).map((n) => n.id);
    const hood =
      focus && byId.has(focus.id)
        ? neighbourhood(candidateEdges, focus.id, {
            depth: focus.depth,
            direction: focus.direction,
            // Informational links are context for the focus itself, only in "both" view.
            includeRelated: showInformational && focus.direction === "both",
          })
        : null;
    return nodes
      .filter((n) => {
        if (hood) {
          if (!hood.has(n.id)) return false;
          if (n.id === focus?.id) return true; // the focus is always shown
        }
        return (
          (!typeFilter || n.type === typeFilter) && (!envFilter || n.environment === envFilter)
        );
      })
      .map((n) => n.id);
  }, [nodes, byId, candidateEdges, focus, typeFilter, envFilter, showInformational, impactLevels]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleIds);
    return candidateEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }, [candidateEdges, visibleIds]);

  const layout = useMemo(
    () =>
      stackLayout(
        visibleIds,
        visibleEdges,
        new Map(visibleIds.map((id) => [id, byId.get(id)!.type])),
      ),
    [visibleIds, visibleEdges, byId],
  );
  const positions = layout.positions;

  // Selected node + its direct neighbours stay bright; everything else dims.
  const highlighted = useMemo(() => {
    // In impact view the root is the subject: selecting it must not dim the affected resources.
    if (!selectedId || selectedId === impactId) return null;
    const set = new Set([selectedId]);
    for (const e of visibleEdges) {
      if (e.from === selectedId) set.add(e.to);
      if (e.to === selectedId) set.add(e.from);
    }
    return set;
  }, [selectedId, visibleEdges, impactId]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<ResourceFlowNode>([]);

  // Re-layout when the visible graph changes (user-dragged positions are cosmetic).
  useEffect(() => {
    setFlowNodes(
      visibleIds.map((id) => ({
        id,
        type: "resource",
        position: positions.get(id)!,
        data: { resource: byId.get(id)!, dimmed: false, isFocus: false, impact: null },
      })),
    );
    // Show everything when it stays readable; otherwise open on the largest
    // group, and on its top (entry points) when even that is too big (M26).
    let frame = 0;
    let tries = 0;
    const show = () => {
      const { width, height } = store.getState();
      // The canvas may not be measured yet on the first frames.
      if ((!width || !height) && tries++ < 20) {
        frame = requestAnimationFrame(show);
        return;
      }
      const box = (ids: readonly string[]) => {
        const pts = ids.map((id) => positions.get(id)!).filter(Boolean);
        const x = Math.min(...pts.map((p) => p.x));
        const y = Math.min(...pts.map((p) => p.y));
        const w = Math.max(...pts.map((p) => p.x)) + NODE_WIDTH - x;
        const h = Math.max(...pts.map((p) => p.y)) + NODE_HEIGHT - y;
        return { x, y, w, h, zoom: Math.min(width / (w * 1.3), height / (h * 1.3)) };
      };
      if (!width || !height || visibleIds.length === 0) return;
      if (box(visibleIds).zoom >= READABLE_ZOOM) {
        void fitView({ padding: 0.3, duration: 250, maxZoom: 1.2 });
        return;
      }
      const main = box(layout.primary);
      if (main.zoom >= READABLE_ZOOM) {
        void fitView({ nodes: layout.primary.map((id) => ({ id })), padding: 0.3, duration: 250 });
        return;
      }
      void setViewport(
        {
          zoom: READABLE_ZOOM,
          x: width / 2 - (main.x + main.w / 2) * READABLE_ZOOM,
          y: 48 - main.y * READABLE_ZOOM,
        },
        { duration: 250 },
      );
    };
    frame = requestAnimationFrame(show);
    return () => cancelAnimationFrame(frame);
  }, [visibleIds, positions, layout, byId, setFlowNodes, fitView, setViewport, store]);

  // Selection / focus styling without touching positions.
  useEffect(() => {
    setFlowNodes((current) =>
      current.map((n) => ({
        ...n,
        selected: n.id === selectedId,
        data: {
          ...n.data,
          dimmed: highlighted ? !highlighted.has(n.id) : false,
          isFocus: n.id === focus?.id,
          impact: impactLevels?.get(n.id) ?? null,
        },
      })),
    );
  }, [highlighted, selectedId, focus, impactLevels, setFlowNodes, visibleIds]);

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((e) => {
        const confidence = edgeConfidence(e.status, e.origin)!;
        const informational = dependencyDirection(e) === null;
        const { source, target } = drawDirection(e);
        const phrase = informational
          ? RELATIONSHIP_TYPE_INFO[e.type].label
          : perspective(e, source).phrase;
        const connected = selectedId !== null && (source === selectedId || target === selectedId);
        const onImpactPath = impactEdgeIds.has(e.id);
        const color = connected
          ? COLORS.highlight
          : onImpactPath
            ? COLORS.impact
            : informational
              ? COLORS.informational
              : COLORS.edge;
        // Leave and enter on the facing sides: an edge to something above
        // (exposed through, monitored by…) goes out the top and in the bottom.
        const up = (positions.get(target)?.y ?? 0) < (positions.get(source)?.y ?? 0);
        return {
          id: e.id,
          source,
          target,
          sourceHandle: up ? "top-out" : "bottom-out",
          targetHandle: up ? "bottom-in" : "top-in",
          label: connected ? phrase : undefined,
          labelStyle: { fill: COLORS.label, fontSize: 11 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          zIndex: connected ? 10 : 0,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          style: {
            stroke: color,
            strokeWidth: connected ? 1.6 : 1.1,
            // Same encoding as ConfidenceBadge: solid / dashed / dotted.
            strokeDasharray:
              confidence === "detected" ? "6 4" : confidence === "inferred" ? "1.5 4" : undefined,
            opacity: highlighted && !connected ? 0.2 : impactLevels && !onImpactPath ? 0.35 : 1,
          },
        };
      }),
    [visibleEdges, selectedId, highlighted, impactEdgeIds, impactLevels, positions],
  );

  // Keep ?focus= / ?impact= in the URL so a view can be shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (focus) url.searchParams.set("focus", focus.id);
    else url.searchParams.delete("focus");
    if (impactId) url.searchParams.set("impact", impactId);
    else url.searchParams.delete("impact");
    window.history.replaceState(null, "", url);
  }, [focus, impactId]);

  const focusOn = useCallback((id: string) => {
    setImpactId(null);
    setFocus((f) => ({ id, depth: f?.depth ?? 2, direction: f?.direction ?? "both" }));
    setSelectedId(id);
  }, []);

  const showImpact = useCallback((id: string) => {
    setFocus(null);
    setImpactId(id);
    setSelectedId(id);
  }, []);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const focusNode = focus ? byId.get(focus.id) : undefined;
  const impactRoot = impactResult ? byId.get(impactResult.rootId) : undefined;

  /** M17: export exactly what is on screen (filters, focus or impact). */
  const exportView = useCallback(
    async (format: "png" | "pdf") => {
      const now = new Date();
      let view = "Map";
      let subtitle: string;
      if (impactResult && impactRoot) {
        const by = (c: string) => impactResult.affected.filter((a) => a.confidence === c).length;
        view = `Impact of ${impactRoot.name}`;
        subtitle = `If ${impactRoot.name} fails, ${impactResult.affected.length} resources could be affected (${by("confirmed")} confirmed, ${by("detected")} detected, ${by("inferred")} inferred)`;
      } else if (focus && focusNode) {
        const dir =
          focus.direction === "both"
            ? "both ways"
            : focus.direction === "dependsOn"
              ? "what it depends on"
              : "what uses it";
        view = `Around ${focusNode.name}`;
        subtitle = `Focus on ${focusNode.name}: ${dir}, ${focus.depth === 99 ? "all hops" : `${focus.depth} hop${focus.depth === 1 ? "" : "s"}`}`;
      } else {
        const parts = [
          typeFilter
            ? `Type: ${RESOURCE_TYPES[typeFilter as keyof typeof RESOURCE_TYPES].label}`
            : null,
          envFilter
            ? `Environment: ${ENVIRONMENTS[envFilter as keyof typeof ENVIRONMENTS].label}`
            : null,
        ].filter(Boolean);
        subtitle = parts.length ? parts.join(" · ") : "All resources";
        if (!showUnconfirmed) subtitle += " · confirmed relationships only";
      }
      subtitle += ` · ${visibleIds.length} resources, ${visibleEdges.length} relationships`;
      const position = new Map(flowNodes.map((n) => [n.id, n.position]));
      const scene = buildScene({
        title: `${workspaceName} — ${view}`,
        subtitle,
        stamp: `Exported ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(now)} · InfraMole`,
        impactMode: !!impactLevels,
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        nodes: visibleIds.map((id) => {
          const r = byId.get(id)!;
          const p = position.get(id) ?? positions.get(id)!;
          return {
            id,
            name: r.name,
            typeLabel: [
              RESOURCE_TYPES[r.type].label,
              r.environment ? ENVIRONMENTS[r.environment].label : null,
            ]
              .filter(Boolean)
              .join(" · "),
            environment: r.environment,
            criticality: r.criticality,
            x: p.x,
            y: p.y,
            impact: (impactLevels?.get(id) ?? null) as ExportImpact | null,
          };
        }),
        edges: visibleEdges.map((e) => {
          const { source, target } = drawDirection(e);
          return {
            source,
            target,
            confidence: edgeConfidence(e.status, e.origin)!,
            informational: dependencyDirection(e) === null,
            onImpactPath: impactEdgeIds.has(e.id),
          };
        }),
      });
      const fileName = exportFileName(workspaceName, view, now, format);
      const style = getComputedStyle(document.body);
      const fonts = {
        sans: style.fontFamily,
        mono:
          getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim() ||
          "ui-monospace, Consolas, Menlo, monospace",
      };
      if (format === "png") await downloadPng(scene, fileName, fonts);
      else await downloadPdf(scene, fileName, `${workspaceName} — ${view}`, fonts);
    },
    [
      impactResult,
      impactRoot,
      focus,
      focusNode,
      typeFilter,
      envFilter,
      showUnconfirmed,
      visibleIds,
      visibleEdges,
      flowNodes,
      positions,
      workspaceName,
      impactLevels,
      byId,
      impactEdgeIds,
    ],
  );
  const selectedImpact = impactResult?.affected.find((a) => a.resourceId === selectedId);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onNodeDoubleClick={(_, node) => focusOn(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodesConnectable={false}
          edgesFocusable={false}
          colorMode="dark"
          minZoom={0.02}
          maxZoom={2}
          // Large maps (M15): skip rendering nodes and edges outside the viewport.
          onlyRenderVisibleElements={visibleIds.length > DETAILED_LAYOUT_LIMIT}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1d232a" />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            position="bottom-right"
            style={{ marginRight: 56, width: 140, height: 90 }}
            pannable
            zoomable
            nodeColor={(n) =>
              ENV_HEX[(n as ResourceFlowNode).data.resource.environment ?? "OTHER"]!
            }
            maskColor="rgba(10,12,15,0.7)"
          />
        </ReactFlow>

        {/* Toolbar */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center gap-2">
          {impactResult && impactRoot ? (
            <div className="border-warning/60 bg-surface/95 pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border p-1.5 pl-2.5 backdrop-blur">
              <Radar className="text-warning size-3.5" />
              <span className="text-xs">
                If <span className="font-mono">{impactRoot.name}</span> fails,{" "}
                <span className="text-warning font-medium">{impactResult.affected.length}</span>{" "}
                could be affected
              </span>
              {(["confirmed", "detected", "inferred"] as const).map((c) => {
                const n = impactResult.affected.filter((a) => a.confidence === c).length;
                return n > 0 ? (
                  <span key={c} className="inline-flex items-center gap-1 text-xs">
                    <ConfidenceBadge confidence={c} />
                    <span className="font-mono">{n}</span>
                  </span>
                ) : null;
              })}
              <button
                type="button"
                onClick={() => setImpactId(null)}
                aria-label="Exit impact view"
                className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="border-border bg-surface/95 pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border p-1.5 backdrop-blur">
              <Select
                aria-label="Type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-36"
              >
                <option value="">All types</option>
                {entries(RESOURCE_TYPES).map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Environment"
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value)}
                className="w-40"
              >
                <option value="">All environments</option>
                {entries(ENVIRONMENTS).map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Toggle checked={showUnconfirmed} onChange={setShowUnconfirmed}>
                Unconfirmed
              </Toggle>
              <Toggle checked={showInformational} onChange={setShowInformational}>
                Informational
              </Toggle>
            </div>
          )}

          {!impactResult && focusNode && focus && (
            <div className="border-accent/50 bg-surface/95 pointer-events-auto flex items-center gap-2 rounded-lg border p-1.5 pl-2.5 backdrop-blur">
              <Crosshair className="text-accent size-3.5" />
              <span className="font-mono text-xs">{focusNode.name}</span>
              <Select
                aria-label="Focus direction"
                value={focus.direction}
                onChange={(e) => setFocus({ ...focus, direction: e.target.value as Direction })}
                className="w-32"
              >
                <option value="both">Both ways</option>
                <option value="dependsOn">Depends on</option>
                <option value="usedBy">Used by</option>
              </Select>
              <Select
                aria-label="Focus depth"
                value={String(focus.depth)}
                onChange={(e) => setFocus({ ...focus, depth: Number(e.target.value) })}
                className="w-24"
              >
                <option value="1">1 hop</option>
                <option value="2">2 hops</option>
                <option value="3">3 hops</option>
                <option value="99">All</option>
              </Select>
              <button
                type="button"
                onClick={() => setFocus(null)}
                aria-label="Clear focus"
                className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          <span className="text-subtle pointer-events-auto ml-auto font-mono text-[11px]">
            {visibleIds.length} resources · {visibleEdges.length} relationships
          </span>
          <ExportMenu onExport={exportView} />
        </div>

        <Legend />
      </div>

      {selected && (
        <MapInspector
          workspaceSlug={workspaceSlug}
          resource={selected}
          edges={candidateEdges}
          byId={byId}
          isFocus={focus?.id === selected.id}
          isImpactRoot={impactResult?.rootId === selected.id}
          impactInfo={
            selectedImpact
              ? {
                  confidence: selectedImpact.confidence,
                  depth: selectedImpact.depth,
                  pathNames: selectedImpact.path.map((id) => byId.get(id)?.name ?? "?"),
                }
              : undefined
          }
          onSelect={setSelectedId}
          onFocus={focusOn}
          onImpact={showImpact}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "h-8 rounded-md border px-2.5 text-xs transition-colors",
        checked
          ? "border-border-strong bg-surface-2 text-foreground"
          : "text-subtle hover:text-muted border-transparent",
      )}
    >
      {children}
    </button>
  );
}

function Legend() {
  const line = (dash: string | undefined, color: string) => (
    <svg width="28" height="6" aria-hidden>
      <line x1="0" y1="3" x2="28" y2="3" stroke={color} strokeWidth="1.5" strokeDasharray={dash} />
    </svg>
  );
  return (
    <div className="border-border bg-surface/95 text-muted pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border px-3 py-2 text-[11px] backdrop-blur">
      <span className="flex items-center gap-2">
        {line(undefined, COLORS.edge)} Confirmed dependency
      </span>
      <span className="flex items-center gap-2">
        {line("6 4", COLORS.edge)} Detected relationship
      </span>
      <span className="flex items-center gap-2">
        {line("1.5 4", COLORS.edge)} Inferred relationship
      </span>
      <span className="flex items-center gap-2">
        {line(undefined, COLORS.informational)} Informational (no impact)
      </span>
      <span className="text-subtle mt-1">Arrows point to what a resource depends on.</span>
    </div>
  );
}

/** PNG / PDF of the current view (M17). Rendered in the browser; nothing is uploaded. */
function ExportMenu({ onExport }: { onExport: (format: "png" | "pdf") => Promise<void> }) {
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (format: "png" | "pdf") => {
    setBusy(format);
    setError(null);
    try {
      await onExport(format);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="border-border bg-surface/95 pointer-events-auto flex items-center gap-1 rounded-lg border p-1 pl-2 text-xs backdrop-blur">
      <Download className="text-subtle size-3.5" aria-hidden />
      <span className="text-muted">Export</span>
      {(["png", "pdf"] as const).map((f) => (
        <button
          key={f}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(f)}
          aria-label={`Export this view as ${f.toUpperCase()}`}
          className="hover:bg-surface-2 hover:text-foreground text-muted rounded px-1.5 py-0.5 font-mono uppercase disabled:opacity-50"
        >
          {busy === f ? "…" : f}
        </button>
      ))}
      {error && (
        <span role="alert" className="text-danger pl-1">
          {error}
        </span>
      )}
    </div>
  );
}
