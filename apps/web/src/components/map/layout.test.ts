// SPDX-License-Identifier: AGPL-3.0-only
import type { GraphEdge } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import type { ResourceType } from "@/generated/prisma/enums";
import { MAX_ROW, NODE_HEIGHT, drawDirection, layoutGraph, placeRow, stackLayout } from "./layout";
import { layoutMetrics } from "./layout-metrics";

const e = (id: string, from: string, type: GraphEdge["type"], to: string): GraphEdge => ({
  id,
  from,
  to,
  type,
});
const typed = (entries: [string, ResourceType][]) => new Map(entries);

describe("drawDirection", () => {
  it("draws dependent -> dependency", () => {
    expect(drawDirection(e("1", "api", "USES_DATABASE", "db"))).toEqual({
      source: "api",
      target: "db",
    });
    expect(drawDirection(e("2", "pve", "HOSTS", "vm"))).toEqual({ source: "vm", target: "pve" });
    expect(drawDirection(e("3", "app", "MONITORED_BY", "zbx"))).toEqual({
      source: "app",
      target: "zbx",
    });
  });
});

describe("stack layout (M26)", () => {
  it("places dependents above their dependencies", () => {
    const edges = [
      e("1", "web", "CALLS", "api"),
      e("2", "api", "USES_DATABASE", "db"),
      e("3", "pve", "HOSTS", "db"),
    ];
    const pos = layoutGraph(["web", "api", "db", "pve"], edges);
    expect(pos.get("web")!.y).toBeLessThan(pos.get("api")!.y);
    expect(pos.get("api")!.y).toBeLessThan(pos.get("db")!.y);
    expect(pos.get("db")!.y).toBeLessThan(pos.get("pve")!.y); // db runs on pve
  });

  it("reads like a stack: entry points on top, hosts at the bottom, same types aligned", () => {
    const types = typed([
      ["cdn", "EXTERNAL_SERVICE"],
      ["shop.example.com", "DOMAIN"],
      ["shop", "APPLICATION"],
      ["blog", "APPLICATION"],
      ["shopdb", "DATABASE"],
      ["blogdb", "DATABASE"],
      ["srv1", "SERVER"],
      ["srv2", "SERVER"],
    ]);
    const edges = [
      e("1", "shop.example.com", "EXPOSED_THROUGH", "cdn"),
      e("2", "shop.example.com", "DEPENDS_ON", "shop"),
      e("3", "shop", "USES_DATABASE", "shopdb"),
      e("4", "blog", "USES_DATABASE", "blogdb"),
      e("5", "shopdb", "RUNS_ON", "srv1"),
      e("6", "blogdb", "RUNS_ON", "srv2"),
      e("7", "blog", "RUNS_ON", "srv2"),
    ];
    const pos = layoutGraph([...types.keys()], edges, types);
    const y = (id: string) => pos.get(id)!.y;
    // The proxy that exposes something is drawn above it (request path).
    expect(y("cdn")).toBeLessThan(y("shop.example.com"));
    expect(y("shop.example.com")).toBeLessThan(y("shop"));
    expect(y("shop")).toBeLessThan(y("shopdb"));
    expect(y("shopdb")).toBeLessThan(y("srv1"));
    // Same type, same row — even across unrelated groups.
    expect(y("shop")).toBe(y("blog"));
    expect(y("shopdb")).toBe(y("blogdb"));
    expect(y("srv1")).toBe(y("srv2"));
  });

  it("never overlaps, survives cycles and ignores edges to hidden nodes", () => {
    const pos = layoutGraph(
      ["a", "b", "c"],
      [e("1", "a", "CALLS", "b"), e("2", "b", "CALLS", "a"), e("3", "a", "CALLS", "hidden")],
    );
    expect([...pos.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(layoutMetrics(pos, []).overlaps).toBe(0);
  });

  it("packs separate groups into a screen-like shape and trays the unconnected", () => {
    const ids: string[] = [];
    const edges: GraphEdge[] = [];
    for (let g = 0; g < 12; g++) {
      ids.push(`app${g}`, `db${g}`, `srv${g}`);
      edges.push(e(`a${g}`, `app${g}`, "USES_DATABASE", `db${g}`));
      edges.push(e(`b${g}`, `db${g}`, "RUNS_ON", `srv${g}`));
    }
    for (let i = 0; i < 9; i++) ids.push(`lonely${i}`);
    const { positions, primary } = stackLayout(ids, edges);
    const m = layoutMetrics(positions, edges);
    expect(m.overlaps).toBe(0);
    expect(m.upward).toBe(0);
    expect(m.aspect).toBeGreaterThan(0.8);
    expect(m.aspect).toBeLessThan(3);
    expect(primary).toHaveLength(3);
    // Unconnected resources share a compact grid below the groups.
    const lonelyY = new Set(
      ids.filter((id) => id.startsWith("lonely")).map((id) => positions.get(id)!.y),
    );
    expect(lonelyY.size).toBeLessThanOrEqual(2);
  });

  it("wraps a hub's many dependents into rows, the hub below them all", () => {
    const ids = ["dc", ...Array.from({ length: 40 }, (_, i) => `srv${i}`)];
    const edges = ids.slice(1).map((id, i) => e(`e${i}`, id, "AUTHENTICATES_WITH", "dc"));
    const pos = layoutGraph(ids, edges);
    const rows = new Set(ids.slice(1).map((id) => pos.get(id)!.y));
    expect(rows.size).toBe(Math.ceil(40 / MAX_ROW));
    expect(pos.get("dc")!.y).toBeGreaterThan(Math.max(...rows));
    expect(layoutMetrics(pos, edges).overlaps).toBe(0);
  });

  it("lays out 2,000 nodes quickly", () => {
    const n = 2000;
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    const edges: GraphEdge[] = [];
    for (let i = 40; i < n; i++) {
      edges.push(e(`a${i}`, `n${i}`, "AUTHENTICATES_WITH", `n${i % 40}`));
      if (i >= 340) edges.push(e(`b${i}`, `n${i}`, "USES_DATABASE", `n${40 + (i % 300)}`));
    }
    const start = performance.now();
    const pos = layoutGraph(ids, edges);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(pos.size).toBe(n);
    expect(pos.get("n500")!.y).toBeLessThan(pos.get("n45")!.y); // app above its database
  });
});

describe("placeRow", () => {
  it("keeps order and spacing, as close as possible to the wished positions", () => {
    expect(placeRow([0, 0, 0]).map(Math.round)).toEqual([-240, 0, 240]);
    expect(placeRow([0, 1000])).toEqual([0, 1000]);
    const xs = placeRow([500, 100, 300]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(240);
    expect(NODE_HEIGHT).toBe(40);
  });
});
