// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { jpegToPdf, pageSizeFor } from "@/lib/map-export/pdf";
import { ENV_COLORS, PALETTE, exportScale, type Scene } from "@/lib/map-export/scene";

/**
 * Paints an export scene (lib/map-export/scene.ts) on a canvas and downloads
 * it as PNG or PDF (M17). Everything happens in the browser: the map never
 * leaves it and no request is made.
 */

interface Fonts {
  sans: string;
  mono: string;
}

const FALLBACK: Fonts = {
  sans: "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "ui-monospace, Consolas, Menlo, monospace",
};

export function paintScene(scene: Scene, fonts: Fonts = FALLBACK): HTMLCanvasElement {
  const scale = exportScale(scene.width, scene.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.scale(scale, scale);

  ctx.fillStyle = PALETTE.background;
  ctx.fillRect(0, 0, scene.width, scene.height);

  // Header: title, subtitle, stamp, legend.
  const m = scene.margin;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `600 20px ${fonts.sans}`;
  ctx.fillText(fit(ctx, scene.title, scene.width - 2 * m - 260), m, m + 8);
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `14px ${fonts.sans}`;
  ctx.fillText(fit(ctx, scene.subtitle, scene.width - 2 * m), m, m + 32);
  ctx.fillStyle = PALETTE.subtle;
  ctx.font = `12px ${fonts.sans}`;
  ctx.textAlign = "right";
  ctx.fillText(scene.stamp, scene.width - m, m + 6);
  ctx.textAlign = "left";

  let lx = m;
  const ly = m + 58;
  ctx.font = `12px ${fonts.sans}`;
  for (const item of scene.legend) {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.label === "Fails" || item.label === "Could be affected" ? 2 : 1.4;
    ctx.setLineDash(item.dash);
    ctx.beginPath();
    ctx.moveTo(lx, ly - 4);
    ctx.lineTo(lx + 26, ly - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(item.label, lx + 32, ly);
    lx += 32 + ctx.measureText(item.label).width + 22;
  }
  ctx.strokeStyle = "#e6e8ec";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(m, m + 72);
  ctx.lineTo(scene.width - m, m + 72);
  ctx.stroke();

  // Edges first, nodes on top.
  for (const e of scene.edges) {
    const dy = Math.max(40, Math.abs(e.to.y - e.from.y));
    const c1 = { x: e.from.x, y: e.from.y + dy / 2 };
    const c2 = { x: e.to.x, y: e.to.y - dy / 2 };
    ctx.strokeStyle = e.color;
    ctx.lineWidth = e.width;
    ctx.setLineDash(e.dash);
    ctx.beginPath();
    ctx.moveTo(e.from.x, e.from.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.to.x, e.to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead at the dependency, along the curve's end tangent.
    const angle = Math.atan2(e.to.y - c2.y, e.to.x - c2.x);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(e.to.x, e.to.y);
    ctx.lineTo(e.to.x - 8 * Math.cos(angle - 0.4), e.to.y - 8 * Math.sin(angle - 0.4));
    ctx.lineTo(e.to.x - 8 * Math.cos(angle + 0.4), e.to.y - 8 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  for (const n of scene.nodes) {
    const w = 188;
    const h = 40;
    roundRect(ctx, n.sx, n.sy, w, h, 6);
    ctx.fillStyle = n.fill;
    ctx.fill();
    ctx.strokeStyle = n.border;
    ctx.lineWidth = n.impact === "root" ? 2 : 1;
    ctx.setLineDash(n.dash);
    ctx.stroke();
    ctx.setLineDash([]);
    const bar =
      n.criticality === "CRITICAL"
        ? PALETTE.critical
        : n.criticality === "HIGH"
          ? PALETTE.high
          : null;
    if (bar) {
      ctx.fillStyle = bar;
      ctx.fillRect(n.sx + 1, n.sy + 4, 2.5, h - 8);
    }
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `12px ${fonts.mono}`;
    ctx.fillText(fit(ctx, n.name, w - 20), n.sx + 10, n.sy + 17);
    let tx = n.sx + 10;
    if (n.environment) {
      ctx.fillStyle = ENV_COLORS[n.environment] ?? PALETTE.subtle;
      ctx.beginPath();
      ctx.arc(tx + 3, n.sy + 28, 3, 0, Math.PI * 2);
      ctx.fill();
      tx += 10;
    }
    ctx.fillStyle = PALETTE.subtle;
    ctx.font = `10px ${fonts.sans}`;
    ctx.fillText(fit(ctx, n.typeLabel, w - (tx - n.sx) - 8), tx, n.sy + 31);
  }

  // Footer: the honesty note.
  ctx.fillStyle = PALETTE.subtle;
  ctx.font = `11px ${fonts.sans}`;
  wrap(ctx, scene.note, m, scene.height - scene.footerHeight + 14, scene.width - 2 * m, 15);
  return canvas;
}

export async function downloadPng(scene: Scene, fileName: string, fonts?: Fonts): Promise<void> {
  const canvas = paintScene(scene, fonts);
  const blob = await toBlob(canvas, "image/png");
  save(blob, fileName);
}

export async function downloadPdf(
  scene: Scene,
  fileName: string,
  title: string,
  fonts?: Fonts,
): Promise<void> {
  const canvas = paintScene(scene, fonts);
  const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
  const page = pageSizeFor(scene.width, scene.height);
  const pdf = jpegToPdf({
    jpeg,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    pageWidth: page.width,
    pageHeight: page.height,
    title,
    createdAt: new Date(),
  });
  save(new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" }), fileName);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("The image could not be created."))),
      type,
      quality,
    ),
  );
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

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  max: number,
  lineHeight: number,
) {
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
