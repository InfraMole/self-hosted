// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "./graph";
import { impact, summarizeImpact, type ImpactEdge } from "./impact";
import type { Confidence } from "./relationship-types";

const e = (
  id: string,
  from: string,
  type: GraphEdge["type"],
  to: string,
  confidence: Confidence | null = "confirmed",
): ImpactEdge => ({ id, from, to, type, confidence });

const ids = (r: ReturnType<typeof impact>) => r.affected.map((a) => a.resourceId).sort();
const get = (r: ReturnType<typeof impact>, id: string) =>
  r.affected.find((a) => a.resourceId === id);

describe("impact", () => {
  // PRODUCT.md example.
  const product = [
    e("1", "db", "RUNS_ON", "sql01"),
    e("2", "rotation", "USES_DATABASE", "db"),
    e("3", "portal", "CALLS", "rotation"),
    e("4", "api", "USES_DATABASE", "db"),
    e("5", "web", "CALLS", "api"),
    e("6", "mobile", "CALLS", "api"),
    e("7", "sql01", "BACKS_UP_TO", "nas"),
    e("8", "sql01", "MONITORED_BY", "zabbix"),
    e("9", "sql01", "AUTHENTICATES_WITH", "ad"),
  ];

  it("reproduces the PRODUCT.md blast radius", () => {
    const r = impact(product, "sql01");
    expect(ids(r)).toEqual(["api", "db", "mobile", "portal", "rotation", "web"]);
    expect(get(r, "portal")).toEqual({
      resourceId: "portal",
      depth: 3,
      confidence: "confirmed",
      path: ["sql01", "db", "rotation", "portal"],
      viaEdges: ["1", "2", "3"],
    });
  });

  it("ignores non-propagating types and does not flow towards dependencies", () => {
    const r = impact(product, "sql01");
    expect(get(r, "nas")).toBeUndefined(); // BACKS_UP_TO
    expect(get(r, "zabbix")).toBeUndefined(); // MONITORED_BY
    expect(get(r, "ad")).toBeUndefined(); // sql01 depends on ad, not the other way
    expect(ids(impact(product, "ad"))).toContain("sql01");
  });

  it("respects HOSTS (forward) propagation", () => {
    const r = impact([e("1", "pve", "HOSTS", "vm"), e("2", "app", "RUNS_ON", "vm")], "pve");
    expect(ids(r)).toEqual(["app", "vm"]);
    expect(impact([e("1", "pve", "HOSTS", "vm")], "vm").affected).toEqual([]);
  });

  it("prefers the strongest confidence, then the fewest hops", () => {
    // root -> x directly via a DETECTED edge (1 hop),
    // and via a 3-hop CONFIRMED chain root -> a -> b -> x.
    const edges = [
      e("d", "x", "CONNECTS_TO", "root", "detected"),
      e("1", "a", "DEPENDS_ON", "root"),
      e("2", "b", "DEPENDS_ON", "a"),
      e("3", "x", "DEPENDS_ON", "b"),
    ];
    expect(get(impact(edges, "root"), "x")).toMatchObject({
      confidence: "confirmed",
      depth: 3,
      viaEdges: ["1", "2", "3"],
    });
    // Without the confirmed chain the detected 1-hop path is reported.
    expect(get(impact([edges[0]!], "root"), "x")).toMatchObject({
      confidence: "detected",
      depth: 1,
    });
  });

  it("a path's confidence is its weakest edge", () => {
    const edges = [
      e("1", "a", "DEPENDS_ON", "root"),
      e("2", "b", "DEPENDS_ON", "a", "inferred"),
      e("3", "c", "DEPENDS_ON", "b"),
    ];
    const r = impact(edges, "root");
    expect(get(r, "a")!.confidence).toBe("confirmed");
    expect(get(r, "b")!.confidence).toBe("inferred");
    expect(get(r, "c")!.confidence).toBe("inferred");
  });

  it("excludes ignored edges and confidences not included", () => {
    const edges = [
      e("1", "a", "DEPENDS_ON", "root", null),
      e("2", "b", "DEPENDS_ON", "root", "inferred"),
    ];
    expect(impact(edges, "root").affected.map((a) => a.resourceId)).toEqual(["b"]);
    expect(impact(edges, "root", { include: ["confirmed", "detected"] }).affected).toEqual([]);
  });

  it("is cycle-safe and never reports the root", () => {
    const edges = [
      e("1", "a", "DEPENDS_ON", "root"),
      e("2", "b", "DEPENDS_ON", "a"),
      e("3", "root", "DEPENDS_ON", "b"),
    ];
    const r = impact(edges, "root");
    expect(ids(r)).toEqual(["a", "b"]);
  });

  it("respects maxDepth", () => {
    const chain = [
      e("1", "a", "DEPENDS_ON", "root"),
      e("2", "b", "DEPENDS_ON", "a"),
      e("3", "c", "DEPENDS_ON", "b"),
    ];
    expect(ids(impact(chain, "root", { maxDepth: 2 }))).toEqual(["a", "b"]);
    expect(impact(chain, "root", { maxDepth: 0 }).affected).toEqual([]);
  });

  it("handles unknown or isolated roots", () => {
    expect(impact(product, "nope").affected).toEqual([]);
    expect(impact([], "x").affected).toEqual([]);
  });

  it("sorts strongest first, then by depth", () => {
    const edges = [
      e("1", "far", "DEPENDS_ON", "near"),
      e("2", "near", "DEPENDS_ON", "root"),
      e("3", "weak", "DEPENDS_ON", "root", "detected"),
    ];
    expect(impact(edges, "root").affected.map((a) => a.resourceId)).toEqual([
      "near",
      "far",
      "weak",
    ]);
  });
});

describe("summarizeImpact", () => {
  it("counts by confidence and type", () => {
    const edges = [
      e("1", "a", "DEPENDS_ON", "root"),
      e("2", "b", "DEPENDS_ON", "root", "detected"),
      e("3", "c", "DEPENDS_ON", "root", "inferred"),
    ];
    const types: Record<string, string> = { a: "APPLICATION", b: "APPLICATION", c: "API" };
    expect(summarizeImpact(impact(edges, "root"), (id) => types[id]!)).toEqual({
      total: 3,
      byConfidence: { confirmed: 1, detected: 1, inferred: 1 },
      byType: { APPLICATION: 2, API: 1 },
    });
  });
});
