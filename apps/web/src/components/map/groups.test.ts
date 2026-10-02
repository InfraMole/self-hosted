// SPDX-License-Identifier: AGPL-3.0-only
import type { GraphEdge } from "@depmap/graph";
import { describe, expect, it } from "vitest";
import { RELATIONSHIPS, RESOURCES } from "@/server/modules/demo/example-data";
import { containment, displayGraph, hubs, nestedLayout, withPins } from "./groups";

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
    // What the box-to-box line stands for, and what hides inside a box.
    expect(g.represents.get(g.edges[0]!.id)!.map((x) => x.id)).toEqual(["2"]);
    expect(g.inside.get("srv")!.map((x) => x.id)).toEqual(["1"]); // web calls api, both on srv
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

describe("large maps (M26 scale test)", () => {
  it("lines re-attached to boxes are marked derived (they never set layers)", () => {
    const ids = ["a1", "a2", "vm1", "vm2"];
    const edges = [
      e("1", "a1", "RUNS_ON", "vm1"),
      e("2", "a2", "RUNS_ON", "vm2"),
      e("3", "a1", "CALLS", "a2"),
    ];
    const g = displayGraph(ids, edges, containment(ids, edges), () => false);
    expect(g.edges).toEqual([expect.objectContaining({ from: "vm1", to: "vm2", derived: true })]);
  });

  it("finds hubs: what a large part of the map points to", () => {
    const shown = Array.from({ length: 100 }, (_, i) => `n${i}`);
    const edges = shown.slice(1, 40).map((id) => ({ from: id, to: "n0" }));
    edges.push({ from: "n1", to: "n2" });
    expect(hubs(shown, edges)).toEqual(new Map([["n0", 39]]));
    expect(hubs(shown.slice(0, 10), edges.slice(0, 5))).toEqual(new Map()); // small maps: none
  });
});

describe("withPins", () => {
  const ids = ["web", "api", "srv", "db"];
  const edges = [
    e("1", "web", "RUNS_ON", "srv"),
    e("2", "api", "RUNS_ON", "srv"),
    e("3", "api", "USES_DATABASE", "db"),
  ];
  const g = displayGraph(ids, edges, containment(ids, edges), () => true);
  const auto = nestedLayout(g, new Map());

  it("moves pinned resources, keeps everything else in its automatic place", () => {
    const l = withPins(auto, g, { db: { x: 900, y: 40, parent: null } });
    expect(l.positions.get("db")).toEqual({ x: 900, y: 40 });
    expect(l.positions.get("srv")).toEqual(auto.positions.get("srv"));
    // Children follow their box.
    const moved = withPins(auto, g, { srv: { x: 500, y: 500, parent: null } });
    expect(moved.absolute.get("web")!.x - 500).toBe(auto.positions.get("web")!.x);
  });

  it("a pin applies only in the box it was made in, and stays inside it", () => {
    expect(withPins(auto, g, { web: { x: 5, y: 5, parent: null } }).positions.get("web")).toEqual(
      auto.positions.get("web"),
    );
    const inside = withPins(auto, g, { web: { x: 10_000, y: -50, parent: "srv" } });
    const box = auto.sizes.get("srv")!;
    const p = inside.positions.get("web")!;
    expect(p.x + auto.sizes.get("web")!.width).toBeLessThanOrEqual(box.width);
    expect(p.y).toBeGreaterThan(0);
  });
});
