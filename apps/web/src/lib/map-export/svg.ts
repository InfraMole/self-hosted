// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SVG export (M34): the scene as vector graphics with real text — sharp at
 * any zoom, editable in Inkscape / Illustrator / draw.io, searchable. PURE:
 * text widths come from `measure` (the browser's canvas in the app).
 */
import { drawScene, type Font, type Painter, type Point, type Stroke } from "./draw";
import type { Scene } from "./scene";

export interface SvgFonts {
  sans: string;
  mono: string;
}

const FALLBACK: SvgFonts = {
  sans: "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "ui-monospace, Consolas, Menlo, monospace",
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 does not allow (control characters in a name).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const n = (v: number) => String(Math.round(v * 100) / 100);

function strokeAttrs(s: Stroke): string {
  const dash = s.dash?.length ? ` stroke-dasharray="${s.dash.map(n).join(" ")}"` : "";
  return `stroke="${s.color}" stroke-width="${n(s.width)}"${dash}`;
}

export function sceneToSvg(
  scene: Scene,
  measure: (text: string, font: Font) => number,
  fonts: SvgFonts = FALLBACK,
): string {
  const out: string[] = [];
  const painter: Painter = {
    measure,
    rect: (x, y, w, h, fill) =>
      out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`),
    roundRect: (x, y, w, h, r, style) =>
      out.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${style.fill ?? "none"}"${style.stroke ? ` ${strokeAttrs(style.stroke)}` : ""}/>`,
      ),
    line: (a: Point, b: Point, s) =>
      out.push(
        `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" ${strokeAttrs(s)}/>`,
      ),
    curve: (a, c1, c2, b, s) =>
      out.push(
        `<path d="M${n(a.x)} ${n(a.y)} C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}" fill="none" ${strokeAttrs(s)}/>`,
      ),
    polygon: (points, fill) =>
      out.push(
        `<polygon points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" fill="${fill}"/>`,
      ),
    circle: (cx, cy, r, fill) =>
      out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>`),
    text: (text, x, y, font, color, align = "left") =>
      out.push(
        `<text x="${n(x)}" y="${n(y)}" font-family="${esc(font.family === "mono" ? fonts.mono : fonts.sans)}" font-size="${font.size}"${font.bold ? ' font-weight="600"' : ""}${align === "right" ? ' text-anchor="end"' : ""} fill="${color}">${esc(text)}</text>`,
      ),
  };
  drawScene(scene, painter);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    `<title>${esc(scene.title)}</title>`,
    ...out,
    "</svg>",
    "",
  ].join("\n");
}
