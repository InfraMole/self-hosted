// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { jpegToPdf, pageSizeFor } from "./pdf";
import {
  DASH,
  EXPORT_NOTE,
  PALETTE,
  buildScene,
  exportFileName,
  exportScale,
  type ExportInput,
} from "./scene";

const input = (over: Partial<ExportInput> = {}): ExportInput => ({
  title: "Acme — Map",
  subtitle: "Whole map",
  stamp: "Exported 30 Sep 2026 · InfraMole",
  nodeWidth: 188,
  nodeHeight: 40,
  impactMode: false,
  nodes: [
    {
      id: "app",
      name: "APP01",
      typeLabel: "Server",
      environment: "PRODUCTION",
      criticality: null,
      x: 500,
      y: 100,
      impact: null,
    },
    {
      id: "sql",
      name: "SQL01",
      typeLabel: "Server",
      environment: null,
      criticality: "CRITICAL",
      x: 500,
      y: 204,
      impact: null,
    },
  ],
  edges: [
    {
      source: "app",
      target: "sql",
      confidence: "detected",
      informational: false,
      onImpactPath: false,
    },
    {
      source: "app",
      target: "gone",
      confidence: "confirmed",
      informational: false,
      onImpactPath: false,
    },
  ],
  ...over,
});

describe("buildScene", () => {
  it("normalises positions under the header and draws edges bottom → top", () => {
    const scene = buildScene(input());
    const [app, sql] = scene.nodes;
    expect(app!.sy).toBe(scene.headerHeight);
    expect(sql!.sy - app!.sy).toBe(104);
    expect(scene.width).toBeGreaterThanOrEqual(820); // room for the header
    expect(app!.sx + 94).toBeCloseTo(scene.width / 2); // centred
    expect(scene.edges).toHaveLength(1); // edges to nodes outside the view are dropped
    expect(scene.edges[0]).toMatchObject({
      from: { x: app!.sx + 94, y: app!.sy + 40 },
      to: { x: sql!.sx + 94, y: sql!.sy },
      dash: DASH.detected,
    });
    expect(scene.height).toBe(scene.headerHeight + 144 + scene.margin + scene.footerHeight);
    expect(scene.note).toBe(EXPORT_NOTE);
    expect(scene.legend.map((l) => l.label)).toEqual([
      "Confirmed",
      "Detected",
      "Inferred",
      "Informational (no impact)",
    ]);
  });

  it("encodes impact like the app: root red, affected amber with the path's confidence", () => {
    const scene = buildScene(
      input({
        impactMode: true,
        nodes: input().nodes.map((n) => ({ ...n, impact: n.id === "sql" ? "root" : "detected" })),
        edges: [
          {
            source: "app",
            target: "sql",
            confidence: "detected",
            informational: false,
            onImpactPath: true,
          },
        ],
      }),
    );
    expect(scene.nodes.map((n) => [n.border, n.dash])).toEqual([
      [PALETTE.impact, DASH.detected],
      [PALETTE.root, []],
    ]);
    expect(scene.edges[0]!.color).toBe(PALETTE.impact);
    expect(scene.legend.slice(0, 2).map((l) => l.label)).toEqual(["Fails", "Could be affected"]);
  });
});

describe("export helpers", () => {
  it("keeps large canvases within browser limits", () => {
    expect(exportScale(1000, 800)).toBe(2);
    expect(exportScale(4000, 9000) * 9000).toBeLessThanOrEqual(16_000);
    const s = exportScale(9000, 9000);
    expect(9000 * s * 9000 * s).toBeLessThanOrEqual(100_000_001);
  });

  it("builds safe file names", () => {
    expect(
      exportFileName("Acme Café", "Impact of SQL01", new Date("2026-09-30T10:00:00Z"), "png"),
    ).toBe("inframole-acme-cafe-impact-of-sql01-2026-09-30.png");
  });
});

describe("jpegToPdf", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf({
    jpeg,
    pixelWidth: 1640,
    pixelHeight: 800,
    ...(() => {
      const p = pageSizeFor(820, 400);
      return { pageWidth: p.width, pageHeight: p.height };
    })(),
    title: "Acme — Map ✓",
    createdAt: new Date("2026-09-30T10:15:00Z"),
  });
  const text = new TextDecoder("latin1").decode(pdf);

  it("is a one-page PDF that embeds the JPEG unchanged", () => {
    expect(text.startsWith("%PDF-1.4\n%")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 615 300]");
    expect(text).toContain("/Width 1640 /Height 800");
    expect(text).toContain(`/Filter /DCTDecode /Length ${jpeg.length}`);
    expect(text).toContain("/CreationDate (D:20260930101500Z)");
    const start = text.indexOf("stream\n") + "stream\n".length;
    expect([...pdf.slice(start, start + jpeg.length)]).toEqual([...jpeg]);
  });

  it("has a correct cross-reference table", () => {
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const rows = text
      .slice(startxref)
      .split("\n")
      .slice(3, 9)
      .map((r) => Number(r.slice(0, 10)));
    rows.forEach((offset, i) => expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
  });

  it("caps huge pages at the PDF limit", () => {
    expect(pageSizeFor(40_000, 10_000).width).toBe(14_400);
  });
});
