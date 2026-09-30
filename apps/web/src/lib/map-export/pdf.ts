// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A minimal one-page PDF holding a single JPEG (M17). Written by hand to avoid
 * a PDF library: the file is just a catalog, a page, the image (DCTDecode,
 * i.e. the JPEG bytes as they are) and a one-line content stream that draws
 * it full-page. PURE; unit tested for structure and xref offsets.
 */

export interface PdfImage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in points (1/72 in). */
  pageWidth: number;
  pageHeight: number;
  title: string;
  createdAt: Date;
}

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

export function jpegToPdf(img: PdfImage): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const W = round2(img.pageWidth);
  const H = round2(img.pageHeight);
  // Header; the second line marks the file as binary for transfer tools.
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.pixelWidth} /Height ${img.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
  );
  push(img.jpeg);
  push("\nendstream\nendobj\n");
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(
    6,
    `<< /Title ${pdfText(img.title)} /Producer (InfraMole) /CreationDate (${pdfDate(img.createdAt)}) >>`,
  );

  const xrefAt = length;
  const rows = ["0000000000 65535 f \n"];
  for (let n = 1; n <= 6; n++) rows.push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(
    `xref\n0 7\n${rows.join("")}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
