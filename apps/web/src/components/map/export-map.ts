// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { drawScene, type Font, type Painter } from "@/lib/map-export/draw";
import { sceneToPdf } from "@/lib/map-export/pdf";
import { exportScale, type Scene } from "@/lib/map-export/scene";
import { sceneToSvg } from "@/lib/map-export/svg";

/**
 * Downloads an export scene (lib/map-export/scene.ts) as PNG (canvas), SVG
 * or vector PDF (M17, M34). Everything happens in the browser: the map
 * never leaves it and no request is made.
 */

interface Fonts {
  sans: string;
  mono: string;
}

const FALLBACK: Fonts = {
  sans: "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "ui-monospace, Consolas, Menlo, monospace",
};

const cssFont = (font: Font, fonts: Fonts) =>
  `${font.bold ? "600 " : ""}${font.size}px ${font.family === "mono" ? fonts.mono : fonts.sans}`;

/** The canvas implementation of the drawing primitives. */
function canvasPainter(ctx: CanvasRenderingContext2D, fonts: Fonts): Painter {
  const stroke = (s: { color: string; width: number; dash?: number[] }) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.setLineDash(s.dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  return {
    measure: (text, font) => {
      ctx.font = cssFont(font, fonts);
      return ctx.measureText(text).width;
    },
    rect: (x, y, w, h, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    },
    roundRect: (x, y, w, h, r, style) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill();
      }
      if (style.stroke) stroke(style.stroke);
    },
    line: (a, b, s) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      stroke(s);
    },
    curve: (a, c1, c2, b, s) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      stroke(s);
    },
    polygon: (points, fill) => {
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    },
    circle: (cx, cy, r, fill) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    text: (text, x, y, font, color, align = "left") => {
      ctx.font = cssFont(font, fonts);
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(text, x, y);
      ctx.textAlign = "left";
    },
  };
}

export function paintScene(scene: Scene, fonts: Fonts = FALLBACK): HTMLCanvasElement {
  const scale = exportScale(scene.width, scene.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.scale(scale, scale);
  drawScene(scene, canvasPainter(ctx, fonts));
  return canvas;
}

export async function downloadPng(scene: Scene, fileName: string, fonts?: Fonts): Promise<void> {
  const canvas = paintScene(scene, fonts);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("The image could not be created."))),
      "image/png",
    ),
  );
  save(blob, fileName);
}

/** Vector SVG: text widths from the same fonts the SVG names. */
export function downloadSvg(scene: Scene, fileName: string, fonts: Fonts = FALLBACK): void {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const measure = canvasPainter(ctx, fonts).measure;
  save(new Blob([sceneToSvg(scene, measure, fonts)], { type: "image/svg+xml" }), fileName);
}

/** Vector PDF with real text (standard PDF fonts). */
export function downloadPdf(scene: Scene, fileName: string, title: string): void {
  const pdf = sceneToPdf(scene, title, new Date());
  save(new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" }), fileName);
}

function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
