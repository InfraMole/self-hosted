// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map export (M17, ADR-029) — PURE scene building: what to draw and where,
 * in a light "document" style meant for printing and for handing to a
 * client. The painter (components/map/export-map.ts) turns a scene into a
 * canvas; lib/map-export/pdf.ts wraps the image in a PDF. Unit tested.
 */

export type ExportConfidence = "confirmed" | "detected" | "inferred";
export type ExportImpact = "root" | ExportConfidence;

export interface ExportNodeInput {
  id: string;
  name: string;
  typeLabel: string;
  environment: string | null;
  criticality: string | null;
  /** Top-left position on the map (after layout / user drags). */
  x: number;
  y: number;
  impact: ExportImpact | null;
}

export interface ExportEdgeInput {
  /** Drawn from source (dependent, above) to target (dependency, below). */
  source: string;
  target: string;
  confidence: ExportConfidence;
  informational: boolean;
  onImpactPath: boolean;
}

export interface ExportInput {
  title: string;
  subtitle: string;
  /** e.g. "Exported 30 Sep 2026, 10:15 · InfraMole" */
  stamp: string;
  nodes: ExportNodeInput[];
  edges: ExportEdgeInput[];
  impactMode: boolean;
  nodeWidth: number;
  nodeHeight: number;
}

export const PALETTE = {
  background: "#ffffff",
  ink: "#151329",
  muted: "#5b6270",
  subtle: "#8a909b",
  nodeFill: "#ffffff",
  nodeBorder: "#c4c9d2",
  edge: "#7a8290",
  informational: "#c3c8cf",
  impact: "#c2710c",
  root: "#d13b34",
  critical: "#d13b34",
  high: "#c2710c",
  impactFill: "#fff7ec",
  rootFill: "#fdeeee",
} as const;

export const ENV_COLORS: Record<string, string> = {
  PRODUCTION: "#d9534f",
  STAGING: "#c2710c",
  DEVELOPMENT: "#3f7fe0",
  TEST: "#7a5cd6",
  OTHER: "#8a909b",
};

/** Same encoding as the app: solid · dashed · dotted. */
export const DASH: Record<ExportConfidence, number[]> = {
  confirmed: [],
  detected: [6, 4],
  inferred: [1.5, 4],
};

export interface SceneNode extends ExportNodeInput {
  /** Position inside the scene (header offset and margins applied). */
  sx: number;
  sy: number;
  border: string;
  fill: string;
  dash: number[];
}

export interface SceneEdge {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  dash: number[];
  width: number;
}

export interface LegendItem {
  label: string;
  color: string;
  dash: number[];
}

export interface Scene {
  width: number;
  height: number;
  margin: number;
  headerHeight: number;
  footerHeight: number;
  title: string;
  subtitle: string;
  stamp: string;
  note: string;
  legend: LegendItem[];
  nodes: SceneNode[];
  edges: SceneEdge[];
}

const MARGIN = 40;
const HEADER = 118;
const FOOTER = 44;
/** The header and legend need room even for a one-node map. */
const MIN_WIDTH = 820;

export const EXPORT_NOTE =
  "Detected and inferred relationships are suggestions, not confirmed dependencies. Impact shows what could be affected according to the relationships InfraMole knows.";

export function buildScene(input: ExportInput): Scene {
  const { nodes, nodeWidth: w, nodeHeight: h } = input;
  const minX = nodes.length ? Math.min(...nodes.map((n) => n.x)) : 0;
  const minY = nodes.length ? Math.min(...nodes.map((n) => n.y)) : 0;
  const maxX = nodes.length ? Math.max(...nodes.map((n) => n.x + w)) : w;
  const maxY = nodes.length ? Math.max(...nodes.map((n) => n.y + h)) : h;
  const contentW = maxX - minX;
  const width = Math.max(MIN_WIDTH, Math.ceil(contentW + 2 * MARGIN));
  const offsetX = MARGIN + (width - 2 * MARGIN - contentW) / 2 - minX;
  const offsetY = HEADER - minY;
  const height = Math.ceil(HEADER + (maxY - minY) + MARGIN + FOOTER);

  const sceneNodes: SceneNode[] = nodes.map((n) => {
    const impact = n.impact;
    return {
      ...n,
      sx: n.x + offsetX,
      sy: n.y + offsetY,
      border:
        impact === "root"
          ? PALETTE.root
          : impact
            ? impact === "inferred"
              ? PALETTE.subtle
              : PALETTE.impact
            : PALETTE.nodeBorder,
      fill: impact === "root" ? PALETTE.rootFill : impact ? PALETTE.impactFill : PALETTE.nodeFill,
      dash: impact && impact !== "root" ? DASH[impact] : [],
    };
  });

  const at = new Map(sceneNodes.map((n) => [n.id, n]));
  const sceneEdges: SceneEdge[] = [];
  for (const e of input.edges) {
    const s = at.get(e.source);
    const t = at.get(e.target);
    if (!s || !t) continue;
    // Same as the map: an edge to something above leaves from the top.
    const up = t.sy < s.sy;
    sceneEdges.push({
      from: { x: s.sx + w / 2, y: up ? s.sy : s.sy + h },
      to: { x: t.sx + w / 2, y: up ? t.sy + h : t.sy },
      color: e.onImpactPath
        ? PALETTE.impact
        : e.informational
          ? PALETTE.informational
          : PALETTE.edge,
      dash: DASH[e.confidence],
      width: e.onImpactPath ? 1.6 : 1.1,
    });
  }

  const legend: LegendItem[] = [
    { label: "Confirmed", color: PALETTE.edge, dash: DASH.confirmed },
    { label: "Detected", color: PALETTE.edge, dash: DASH.detected },
    { label: "Inferred", color: PALETTE.edge, dash: DASH.inferred },
    { label: "Informational (no impact)", color: PALETTE.informational, dash: [] },
  ];
  if (input.impactMode) {
    legend.unshift(
      { label: "Fails", color: PALETTE.root, dash: [] },
      { label: "Could be affected", color: PALETTE.impact, dash: [] },
    );
  }

  return {
    width,
    height,
    margin: MARGIN,
    headerHeight: HEADER,
    footerHeight: FOOTER,
    title: input.title,
    subtitle: input.subtitle,
    stamp: input.stamp,
    note: EXPORT_NOTE,
    legend,
    nodes: sceneNodes,
    edges: sceneEdges,
  };
}

/**
 * Pixel ratio for the canvas: sharp (2×) when small, reduced so large maps
 * stay within what browsers can allocate (16,384 px per side, ~100 MP).
 */
export function exportScale(width: number, height: number): number {
  const bySide = 16_000 / Math.max(width, height);
  const byArea = Math.sqrt(100_000_000 / (width * height));
  return Math.max(0.25, Math.min(2, bySide, byArea));
}

/** Safe file name: "inframole-acme-map-2026-09-30.png". */
export function exportFileName(workspace: string, view: string, date: Date, ext: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "map";
  const day = date.toISOString().slice(0, 10);
  return `inframole-${slug(workspace)}-${slug(view)}-${day}.${ext}`;
}
