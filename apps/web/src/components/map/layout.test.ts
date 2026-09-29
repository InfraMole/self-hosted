// SPDX-License-Identifier: AGPL-3.0-only
import type { GraphEdge } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import {
  DETAILED_LAYOUT_LIMIT,
  MAX_ROW,
  drawDirection,
  layeredLayout,
  layoutGraph,
} from "./layout";

const e = (id: string, from: string, type: GraphEdge["type"], to: string): GraphEdge => ({
  id,
  from,
  to,
  type,
});

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

describe("layoutGraph", () => {
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

  it("ignores edges to nodes that are not displayed and handles cycles", () => {
    const pos = layoutGraph(
      ["a", "b"],
      [e("1", "a", "CALLS", "b"), e("2", "b", "CALLS", "a"), e("3", "a", "CALLS", "hidden")],
    );
    expect([...pos.keys()].sort()).toEqual(["a", "b"]);
  });

  it("lays out 250 nodes / 400 edges fast enough for interactive filtering (ADR-003 spike)", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `n${i}`);
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 400; i++) {
      const a = Math.floor(rand() * 250);
      const b = Math.floor(rand() * 250);
      if (a !== b) edges.push(e(`e${i}`, `n${Math.min(a, b)}`, "DEPENDS_ON", `n${Math.max(a, b)}`));
    }
    const start = performance.now();
    const pos = layoutGraph(ids, edges);
    const ms = performance.now() - start;
    expect(pos.size).toBe(250);
    expect(ms).toBeLessThan(1500);
  });
});

describe("layeredLayout (large maps, M15)", () => {
  it("keeps dependents above dependencies, wraps wide layers and never overlaps", () => {
    const ids = ["dc", ...Array.from({ length: 70 }, (_, i) => `app${i}`)];
    const edges = ids.slice(1).map((id, i) => e(`e${i}`, id, "AUTHENTICATES_WITH", "dc"));
    const pos = layeredLayout(ids, edges);
    for (const id of ids.slice(1)) expect(pos.get(id)!.y).toBeLessThan(pos.get("dc")!.y);
    const rows = new Set(ids.slice(1).map((id) => pos.get(id)!.y));
    expect(rows.size).toBe(Math.ceil(70 / MAX_ROW));
    const spots = new Set([...pos.values()].map((p) => `${p.x}|${p.y}`));
    expect(spots.size).toBe(ids.length);
  });

  it("survives cycles and ignores informational edges for layering", () => {
    const pos = layeredLayout(
      ["a", "b", "c"],
      [e("1", "a", "CALLS", "b"), e("2", "b", "CALLS", "a"), e("3", "c", "MONITORED_BY", "a")],
    );
    expect([...pos.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("is used above the detailed limit and lays out 2,000 nodes quickly", () => {
    const n = 2000;
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    const edges: GraphEdge[] = [];
    for (let i = 40; i < n; i++) {
      edges.push(e(`a${i}`, `n${i}`, "AUTHENTICATES_WITH", `n${i % 40}`));
      if (i >= 340) edges.push(e(`b${i}`, `n${i}`, "USES_DATABASE", `n${40 + (i % 300)}`));
    }
    expect(n).toBeGreaterThan(DETAILED_LAYOUT_LIMIT);
    const start = performance.now();
    const pos = layoutGraph(ids, edges);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(pos.size).toBe(n);
    expect(pos.get("n500")!.y).toBeLessThan(pos.get("n45")!.y); // app above its database
  });
});

describe("wrapWideLayers", () => {
  it("wraps a hub's many dependents into rows in the detailed layout too", () => {
    const ids = ["dc", ...Array.from({ length: 40 }, (_, i) => `srv${i}`)];
    const edges = ids.slice(1).map((id, i) => e(`e${i}`, id, "AUTHENTICATES_WITH", "dc"));
    const pos = layoutGraph(ids, edges); // 41 nodes: dagre
    const rows = new Set(ids.slice(1).map((id) => pos.get(id)!.y));
    expect(rows.size).toBe(Math.ceil(40 / MAX_ROW));
    const lowest = Math.max(...rows);
    expect(pos.get("dc")!.y).toBeGreaterThan(lowest); // still below everything that needs it
    expect(new Set([...pos.values()].map((p) => `${p.x}|${p.y}`)).size).toBe(ids.length);
  });
});
