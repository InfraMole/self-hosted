// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vector PDF export (M17, M34). Written by hand to avoid a PDF library: one
 * page whose content stream draws the scene with PDF operators (lines,
 * Bézier curves, real text in the standard Helvetica and Courier fonts), so
 * it stays sharp at any zoom and its text can be selected and searched.
 * PURE; unit tested for structure, xref offsets and text encoding.
 *
 * The standard fonts cover Western European text (WinAnsi); other characters
 * become "?" — the SVG export keeps every character.
 */
import { drawScene, type Font, type Painter, type Point, type Stroke } from "./draw";
import type { Scene } from "./scene";

/** PDF's largest page side is 14,400 pt. 96 dpi CSS pixels → 72 dpi points. */
export function pageSizeFor(
  cssWidth: number,
  cssHeight: number,
): { width: number; height: number } {
  const k = Math.min(0.75, 14_400 / Math.max(cssWidth, cssHeight));
  return { width: round2(cssWidth * k), height: round2(cssHeight * k) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** UTF-16BE hex string, safe for any title. */
function pdfText(s: string): string {
  let hex = "FEFF";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, "0");
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// ───────────────────────── standard fonts ─────────────────────────

/** Helvetica advance widths (1/1000 em) for ASCII 32–126, from the Adobe AFM. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** WinAnsi codes above 127 that are not Latin-1, and their Helvetica widths. */
const WIN_ANSI_EXTRA: Record<number, [number, number]> = {
  0x2026: [0x85, 1000], // …
  0x2013: [0x96, 556], // –
  0x2014: [0x97, 1000], // —
  0x2018: [0x91, 222],
  0x2019: [0x92, 222],
  0x201c: [0x93, 333],
  0x201d: [0x94, 333],
  0x2022: [0x95, 350],
  0x20ac: [0x80, 556],
  0x2122: [0x99, 1000],
};

/** Text as WinAnsi byte codes; "→" becomes "->", accents are kept, the rest "?". */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out.push(code);
    else if (WIN_ANSI_EXTRA[code]) out.push(WIN_ANSI_EXTRA[code]![0]);
    else if (code === 0x2192) out.push(45, 62);
    else {
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      const c = base.codePointAt(0) ?? 63;
      out.push(base.length === 1 && c >= 32 && c <= 126 ? c : 63);
    }
  }
  return out;
}

function byteWidth(b: number, font: Font): number {
  if (font.family === "mono") return 600;
  const base =
    b >= 32 && b <= 126
      ? HELVETICA[b - 32]!
      : (Object.values(WIN_ANSI_EXTRA).find(([code]) => code === b)?.[1] ?? 556);
  // Helvetica-Bold is a little wider; only used to decide where to truncate.
  return font.bold ? base * 1.06 : base;
}

export function pdfMeasure(text: string, font: Font): number {
  return (winAnsi(text).reduce((sum, b) => sum + byteWidth(b, font), 0) * font.size) / 1000;
}

/** A PDF string literal: ( ) \ escaped, bytes outside printable ASCII in octal. */
function literal(bytes: number[]): string {
  let s = "(";
  for (const b of bytes)
    s +=
      b === 40 || b === 41 || b === 92
        ? `\\${String.fromCharCode(b)}`
        : b < 32 || b > 126
          ? `\\${b.toString(8).padStart(3, "0")}`
          : String.fromCharCode(b);
  return `${s})`;
}

// ───────────────────────── drawing ─────────────────────────

const num = (v: number) => String(Math.round(v * 100) / 100);
const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => num(parseInt(h.slice(i, i + 2), 16) / 255)).join(" ");
};
const strokeOps = (s: Stroke) =>
  `${rgb(s.color)} RG ${num(s.width)} w [${(s.dash ?? []).map(num).join(" ")}] 0 d`;

/** Quarter-circle Bézier constant. */
const K = 0.5523;

function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const k = K * r;
  const p = (...v: number[]) => v.map(num).join(" ");
  return [
    `${p(x + r, y)} m`,
    `${p(x + w - r, y)} l`,
    `${p(x + w - r + k, y, x + w, y + r - k, x + w, y + r)} c`,
    `${p(x + w, y + h - r)} l`,
    `${p(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h)} c`,
    `${p(x + r, y + h)} l`,
    `${p(x + r - k, y + h, x, y + h - r + k, x, y + h - r)} c`,
    `${p(x, y + r)} l`,
    `${p(x, y + r - k, x + r - k, y, x + r, y)} c h`,
  ].join(" ");
}

const FONT_NAME = (font: Font) => (font.family === "mono" ? "F3" : font.bold ? "F2" : "F1");

/** The content stream that draws `scene` in scene units (y down). */
export function pdfContent(scene: Scene, k: number, pageHeight: number): string {
  const ops: string[] = [
    // Scale CSS px → points and flip y so the scene draws top-down.
    `${num(k)} 0 0 ${num(-k)} 0 ${num(pageHeight)} cm`,
  ];
  const painter: Painter = {
    measure: pdfMeasure,
    rect: (x, y, w, h, fill) =>
      ops.push(`q ${rgb(fill)} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f Q`),
    roundRect: (x, y, w, h, r, style) => {
      const paint = style.fill && style.stroke ? "B" : style.fill ? "f" : "S";
      ops.push(
        `q ${style.fill ? `${rgb(style.fill)} rg ` : ""}${style.stroke ? `${strokeOps(style.stroke)} ` : ""}${roundRectPath(x, y, w, h, r)} ${paint} Q`,
      );
    },
    line: (a: Point, b: Point, s) =>
      ops.push(`q ${strokeOps(s)} ${num(a.x)} ${num(a.y)} m ${num(b.x)} ${num(b.y)} l S Q`),
    curve: (a, c1, c2, b, s) =>
      ops.push(
        `q ${strokeOps(s)} ${num(a.x)} ${num(a.y)} m ${[c1.x, c1.y, c2.x, c2.y, b.x, b.y].map(num).join(" ")} c S Q`,
      ),
    polygon: (points, fill) =>
      ops.push(
        `q ${rgb(fill)} rg ${points.map((p, i) => `${num(p.x)} ${num(p.y)} ${i ? "l" : "m"}`).join(" ")} h f Q`,
      ),
    circle: (cx, cy, r, fill) => {
      const c = K * r;
      ops.push(
        `q ${rgb(fill)} rg ${num(cx + r)} ${num(cy)} m ` +
          `${[cx + r, cy + c, cx + c, cy + r, cx, cy + r].map(num).join(" ")} c ` +
          `${[cx - c, cy + r, cx - r, cy + c, cx - r, cy].map(num).join(" ")} c ` +
          `${[cx - r, cy - c, cx - c, cy - r, cx, cy - r].map(num).join(" ")} c ` +
          `${[cx + c, cy - r, cx + r, cy - c, cx + r, cy].map(num).join(" ")} c f Q`,
      );
    },
    text: (text, x, y, font, color, align = "left") => {
      const left = align === "right" ? x - pdfMeasure(text, font) : x;
      // Tm flips y back so glyphs are upright in the flipped page.
      ops.push(
        `BT ${rgb(color)} rg /${FONT_NAME(font)} ${font.size} Tf 1 0 0 -1 ${num(left)} ${num(y)} Tm ${literal(winAnsi(text))} Tj ET`,
      );
    },
  };
  drawScene(scene, painter);
  return ops.join("\n");
}

export function sceneToPdf(scene: Scene, title: string, createdAt: Date): Uint8Array {
  const page = pageSizeFor(scene.width, scene.height);
  const k = page.width / scene.width;
  const content = pdfContent(scene, k, page.height);
  const font = (base: string) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;
  return writePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    font("Helvetica"),
    font("Helvetica-Bold"),
    font("Courier"),
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfText(title)} /Producer (InfraMole) /CreationDate (${pdfDate(createdAt)}) >>`,
  ]);
}

/**
 * Objects 1…n (1 = catalog, last = document info) with a correct xref table.
 * Bodies are ASCII, so string length = byte length.
 */
function writePdf(objects: string[]): Uint8Array {
  // Header; the second line marks the file as binary for transfer tools.
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  let length = bytes(out);
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = `${i + 1} 0 obj\n${body}\nendobj\n`;
    out += obj;
    length += bytes(obj);
  });
  const size = objects.length + 1;
  const rows = [
    "0000000000 65535 f \n",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
  ];
  out += `xref\n0 ${size}\n${rows.join("")}trailer\n<< /Size ${size} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
