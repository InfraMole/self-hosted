// SPDX-License-Identifier: AGPL-3.0-only
import type { GraphEdge } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import { RELATIONSHIPS, RESOURCES } from "@/server/modules/demo/example-data";
import { containment, displayGraph, nestedLayout } from "./groups";

const e = (id: string, from: string, type: GraphEdge["type"], to: string): GraphEdge => ({
  id,
  from,
  to,
  type,
});

const demoNodes = RESOURCES.filter((r) => r.status !== "ARCHIVED");
const demoIds = demoNodes.map((r) => r.name);
const demoTypes = new Map(demoNodes.map((r) => [r.name, r.type]));
const demoEdges: GraphEdge[] = RELATIONSHIPS.map(([from, type, to], i) =>
  e(`e${i}`, from, type, to),
);

describe("containment", () => {
  it("puts what runs on / is hosted by exactly one resource inside it, nested", () => {
    const c = containment(demoIds, demoEdges);
    expect(c.parentOf.get("shop-db (DOCKER01)")).toBe("DOCKER01");
    expect(c.parentOf.get("FILE01")).toBe("esx01.corp.local"); // HOSTS
    expect(c.parentOf.get("IT Portal")).toBe("IIS"); // runs on IIS…
    expect(c.parentOf.get("IIS")).toBe("APP01"); // …which runs on APP01
    expect(c.parentOf.get("APP02")).toBe("PVE01");
    // A workload on two Kubernetes nodes stays outside both.
    expect(c.parentOf.has("shop/checkout")).toBe(false);
    expect(c.parentOf.get("shop/orders-db")).toBe("k8s-node2");
  });

  it("never builds a cycle", () => {
    const c = containment(["a", "b"], [e("1", "a", "RUNS_ON", "b"), e("2", "b", "RUNS_ON", "a")]);
    expect(c.parentOf.size).toBe(1);
  });
});

describe("displayGraph", () => {
  const ids = ["web", "api", "db", "srv", "dbsrv"];
  const edges = [
    e("1", "web", "CALLS", "api"),
    e("2", "api", "USES_DATABASE", "db"),
    e("3", "api", "RUNS_ON", "srv"),
    e("4", "db", "RUNS_ON", "dbsrv"),
    e("5", "web", "RUNS_ON", "srv"),
  ];
  const c = containment(ids, edges);

  it("expanded: boxes with their content, placement arrows dropped", () => {
    const g = displayGraph(ids, edges, c, () => true);
    expect(g.expanded).toEqual(new Set(["srv", "dbsrv"]));
    expect(g.parentOf.get("api")).toBe("srv");
    expect(g.edges.map((x) => x.id).sort()).toEqual(["1", "2"]);
    // Parents come before their children.
    expect(g.shown.indexOf("srv")).toBeLessThan(g.shown.indexOf("api"));
  });

  it("collapsed: one node per group, edges re-attached and deduplicated", () => {
    const g = displayGraph(ids, edges, c, () => false);
    expect(g.shown.sort()).toEqual(["dbsrv", "srv"]);
    expect(g.hidden.get("srv")).toBe(2);
    expect(g.edges.map((x) => [x.from, x.type, x.to])).toEqual([["srv", "USES_DATABASE", "dbsrv"]]);
  });
});

describe("nestedLayout on the demo", () => {
  it("boxes contain their content and nothing overlaps at any level", () => {
    const c = containment(demoIds, demoEdges);
    const g = displayGraph(demoIds, demoEdges, c, () => true);
    const l = nestedLayout(g, demoTypes);
    const box = (id: string) => ({ ...l.absolute.get(id)!, ...l.sizes.get(id)! });
    for (const id of g.shown) {
      const parent = g.parentOf.get(id);
      if (!parent) continue;
      const b = box(id);
      const p = box(parent);
      expect(b.x).toBeGreaterThanOrEqual(p.x);
      expect(b.y).toBeGreaterThanOrEqual(p.y);
      expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(p.y + p.height + 0.5);
    }
    // Siblings never overlap.
    for (const a of g.shown)
      for (const b of g.shown) {
        if (a >= b || (g.parentOf.get(a) ?? null) !== (g.parentOf.get(b) ?? null)) continue;
        const A = box(a);
        const B = box(b);
        const overlap =
          A.x < B.x + B.width &&
          B.x < A.x + A.width &&
          A.y < B.y + B.height &&
          B.y < A.y + A.height;
        expect(overlap, `${a} / ${b}`).toBe(false);
      }
    // Fewer top-level things to read than resources.
    const topLevel = g.shown.filter((id) => !g.parentOf.has(id));
    console.log("demo top-level", topLevel.length, "of", demoIds.length);
    expect(topLevel.length).toBeLessThan(demoIds.length * 0.7);
  });
});
