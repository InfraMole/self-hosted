// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { drawScene, type Painter } from "./draw";
import { pageSizeFor, pdfMeasure, sceneToPdf, winAnsi } from "./pdf";
import { sceneToSvg } from "./svg";
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

  it("draws what redundancy covers in its own colour, with a legend (M40)", () => {
    const scene = buildScene(
      input({
        impactMode: true,
        nodes: input().nodes.map((n) => ({ ...n, impact: n.id === "sql" ? "holding" : "covered" })),
      }),
    );
    expect(scene.nodes.map((n) => [n.border, n.dash])).toEqual([
      [PALETTE.covered, DASH.detected],
      [PALETTE.covered, []],
    ]);
    expect(scene.legend.slice(2, 4).map((l) => l.label)).toEqual([
      "Covered by redundancy",
      "Still up (redundancy)",
    ]);
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

describe("drawScene", () => {
  it("draws every node, edge and the honesty note with the same primitives for all outputs", () => {
    const calls: string[] = [];
    const recorder: Painter = {
      measure: (t, f) => t.length * f.size * 0.6,
      rect: () => calls.push("rect"),
      roundRect: () => calls.push("roundRect"),
      line: () => calls.push("line"),
      curve: () => calls.push("curve"),
      polygon: () => calls.push("polygon"),
      circle: () => calls.push("circle"),
      text: (t) => calls.push(`text:${t}`),
    };
    drawScene(buildScene(input()), recorder);
    expect(calls.filter((c) => c === "curve")).toHaveLength(1);
    expect(calls.filter((c) => c === "polygon")).toHaveLength(1); // one arrowhead
    expect(calls.filter((c) => c === "roundRect")).toHaveLength(2);
    expect(calls).toContain("text:APP01");
    expect(calls).toContain("text:Acme — Map");
    expect(calls.some((c) => c.startsWith("text:Detected and inferred"))).toBe(true);
  });
});

describe("SVG export", () => {
  const svg = sceneToSvg(
    buildScene(input({ title: 'Acme <"R&D"> — Map' })),
    (t, f) => t.length * f.size * 0.6,
  );

  it("is a standalone SVG with real, escaped text", () => {
    expect(
      svg.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"',
      ),
    ).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("Acme &lt;&quot;R&amp;D&quot;&gt; — Map");
    expect(svg).toContain(">APP01</text>");
    expect(svg).toMatch(/<path d="M[\d. ]+ C[\d. ]+" fill="none"/);
    expect(svg).toContain('stroke-dasharray="6 4"'); // the detected edge
  });
});

describe("vector PDF export", () => {
  const pdf = sceneToPdf(buildScene(input()), "Acme — Map ✓", new Date("2026-09-30T10:15:00Z"));
  const text = new TextDecoder("latin1").decode(pdf);

  it("is a one-page PDF drawn with operators and standard fonts", () => {
    expect(text.startsWith("%PDF-1.4\n%")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 615 ");
    expect(text).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(text).toContain("/BaseFont /Courier");
    expect(text).toContain("/CreationDate (D:20260930101500Z)");
    expect(text).toContain("(APP01) Tj"); // real, selectable text
    expect(text).toMatch(/ c S Q/); // Bézier edges
    expect(text).not.toContain("/DCTDecode"); // no picture of the map
  });

  it("has a correct cross-reference table and stream length", () => {
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const rows = text
      .slice(startxref)
      .split("\n")
      .slice(3, 11)
      .map((r) => Number(r.slice(0, 10)));
    rows.forEach((offset, i) => expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(text)![1]);
    const body = text.slice(text.indexOf("stream\n") + 7);
    expect(body.slice(length, length + 10)).toBe("\nendstream");
  });

  it("encodes text for the standard fonts and measures it", () => {
    expect(winAnsi("Café → DB…")).toEqual([67, 97, 102, 233, 32, 45, 62, 32, 68, 66, 0x85]);
    expect(winAnsi("服务器")).toEqual([63, 63, 63]);
    // Courier is monospaced: 600/1000 em per character.
    expect(pdfMeasure("SQL01", { family: "mono", size: 10 })).toBe(30);
    expect(pdfMeasure("iiii", { family: "sans", size: 10 })).toBeLessThan(
      pdfMeasure("WWWW", { family: "sans", size: 10 }),
    );
  });

  it("caps huge pages at the PDF limit", () => {
    expect(pageSizeFor(40_000, 10_000).width).toBe(14_400);
  });
});
