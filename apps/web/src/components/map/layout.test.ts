// SPDX-License-Identifier: AGPL-3.0-only
import type { GraphEdge } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import { drawDirection, layoutGraph } from "./layout";

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
