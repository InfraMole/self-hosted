// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map export (M17, M34) — WHAT to draw for a scene, once, for every output:
 * the canvas (PNG), SVG and vector PDF painters only implement these few
 * primitives. PURE; unit tested with a recording painter.
 */
import { ENV_COLORS, PALETTE, type Scene } from "./scene";

export interface Font {
  family: "sans" | "mono";
  size: number;
  bold?: boolean;
}

export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Painter {
  /** Width of `text` in scene units. */
  measure(text: string, font: Font): number;
  rect(x: number, y: number, w: number, h: number, fill: string): void;
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    style: { fill?: string; stroke?: Stroke },
  ): void;
  line(from: Point, to: Point, stroke: Stroke): void;
  curve(from: Point, c1: Point, c2: Point, to: Point, stroke: Stroke): void;
  polygon(points: Point[], fill: string): void;
  circle(cx: number, cy: number, r: number, fill: string): void;
  /** `y` is the text baseline. */
  text(
    text: string,
    x: number,
    y: number,
    font: Font,
    color: string,
    align?: "left" | "right",
  ): void;
}

/** Truncates with "…" to fit `max`. */
export function fitText(p: Painter, text: string, font: Font, max: number): string {
  if (p.measure(text, font) <= max) return text;
  let s = text;
  while (s.length > 1 && p.measure(`${s}…`, font) > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Splits into lines no wider than `max` (by words). */
export function wrapText(p: Painter, text: string, font: Font, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (p.measure(next, font) > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawScene(scene: Scene, p: Painter): void {
  p.rect(0, 0, scene.width, scene.height, PALETTE.background);

  // Header: title, subtitle, stamp, legend.
  const m = scene.margin;
  const title: Font = { family: "sans", size: 20, bold: true };
  const subtitle: Font = { family: "sans", size: 14 };
  const small: Font = { family: "sans", size: 12 };
  p.text(fitText(p, scene.title, title, scene.width - 2 * m - 260), m, m + 8, title, PALETTE.ink);
  p.text(
    fitText(p, scene.subtitle, subtitle, scene.width - 2 * m),
    m,
    m + 32,
    subtitle,
    PALETTE.muted,
  );
  p.text(scene.stamp, scene.width - m, m + 6, small, PALETTE.subtle, "right");

  let lx = m;
  const ly = m + 58;
  for (const item of scene.legend) {
    const strong = item.label === "Fails" || item.label === "Could be affected";
    p.line(
      { x: lx, y: ly - 4 },
      { x: lx + 26, y: ly - 4 },
      {
        color: item.color,
        width: strong ? 2 : 1.4,
        dash: item.dash,
      },
    );
    p.text(item.label, lx + 32, ly, small, PALETTE.muted);
    lx += 32 + p.measure(item.label, small) + 22;
  }
  p.line({ x: m, y: m + 72 }, { x: scene.width - m, y: m + 72 }, { color: "#e6e8ec", width: 1 });

  // Edges first, nodes on top.
  for (const e of scene.edges) {
    const dy = Math.max(40, Math.abs(e.to.y - e.from.y));
    const dir = e.to.y >= e.from.y ? 1 : -1; // edges to something above curve upwards
    const c1 = { x: e.from.x, y: e.from.y + (dir * dy) / 2 };
    const c2 = { x: e.to.x, y: e.to.y - (dir * dy) / 2 };
    p.curve(e.from, c1, c2, e.to, { color: e.color, width: e.width, dash: e.dash });
    // Arrowhead at the dependency, along the curve's end tangent.
    const angle = Math.atan2(e.to.y - c2.y, e.to.x - c2.x);
    p.polygon(
      [
        e.to,
        { x: e.to.x - 8 * Math.cos(angle - 0.4), y: e.to.y - 8 * Math.sin(angle - 0.4) },
        { x: e.to.x - 8 * Math.cos(angle + 0.4), y: e.to.y - 8 * Math.sin(angle + 0.4) },
      ],
      e.color,
    );
  }

  const name: Font = { family: "mono", size: 12 };
  const type: Font = { family: "sans", size: 10 };
  for (const n of scene.nodes) {
    const w = n.width;
    const h = n.group ? 40 : n.height; // a group's header row
    if (n.group)
      // The box around what runs on it, then its header like a node.
      p.roundRect(n.sx, n.sy, n.width, n.height, 8, {
        fill: PALETTE.groupFill,
        stroke: { color: n.border, width: 1 },
      });
    p.roundRect(n.sx, n.sy, w, h, 6, {
      fill: n.fill,
      stroke: { color: n.border, width: n.impact === "root" ? 2 : 1, dash: n.dash },
    });
    const bar =
      n.criticality === "CRITICAL"
        ? PALETTE.critical
        : n.criticality === "HIGH"
          ? PALETTE.high
          : null;
    if (bar) p.rect(n.sx + 1, n.sy + 4, 2.5, h - 8, bar);
    p.text(fitText(p, n.name, name, w - 20), n.sx + 10, n.sy + 17, name, PALETTE.ink);
    let tx = n.sx + 10;
    if (n.environment) {
      p.circle(tx + 3, n.sy + 28, 3, ENV_COLORS[n.environment] ?? PALETTE.subtle);
      tx += 10;
    }
    p.text(fitText(p, n.typeLabel, type, w - (tx - n.sx) - 8), tx, n.sy + 31, type, PALETTE.subtle);
  }

  // Footer: the honesty note.
  const note: Font = { family: "sans", size: 11 };
  wrapText(p, scene.note, note, scene.width - 2 * m).forEach((line, i) =>
    p.text(line, m, scene.height - scene.footerHeight + 14 + i * 15, note, PALETTE.subtle),
  );
}
