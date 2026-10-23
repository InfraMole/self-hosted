// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "./graph";
import { changeImpact, impact, summarizeImpact, type ImpactEdge } from "./impact";
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

describe("changeImpact", () => {
  // sql01 ← db ← app ← web ; app02 → (detected) cache ; web ← (inferred) portal
  const edges = [
    e("1", "db", "RUNS_ON", "sql01"),
    e("2", "app", "USES_DATABASE", "db"),
    e("3", "web", "CALLS", "app"),
    e("4", "app", "RUNS_ON", "app02"),
    e("5", "cache", "RUNS_ON", "app02", "detected"),
    e("6", "portal", "CALLS", "web", "inferred"),
    e("7", "sql01", "MONITORED_BY", "zabbix"),
  ];

  it("combines several changed resources and says which ones reach each", () => {
    const r = changeImpact(edges, ["sql01", "app02"]);
    expect(r.rootIds).toEqual(["sql01", "app02"]);
    const byId = new Map(r.affected.map((a) => [a.resourceId, a]));
    expect([...byId.keys()].sort()).toEqual(["app", "cache", "db", "portal", "web"]);
    // app is reached from both: the shorter path (app02, 1 hop) wins, both are causes.
    expect(byId.get("app")).toMatchObject({
      depth: 1,
      path: ["app02", "app"],
      causes: ["sql01", "app02"],
    });
    expect(byId.get("cache")).toMatchObject({ confidence: "detected", causes: ["app02"] });
    expect(byId.get("portal")).toMatchObject({ confidence: "inferred" });
  });

  it("never lists a changed resource as affected, and dedupes the input", () => {
    const r = changeImpact(edges, ["sql01", "db", "sql01"]);
    expect(r.rootIds).toEqual(["sql01", "db"]);
    expect(r.affected.map((a) => a.resourceId)).not.toContain("db");
    expect(r.affected.find((a) => a.resourceId === "app")?.causes).toEqual(["sql01", "db"]);
  });

  it("keeps the strongest evidence over a shorter but weaker path", () => {
    const r = changeImpact(
      [e("1", "x", "CALLS", "a", "detected"), e("2", "y", "CALLS", "b"), e("3", "x", "CALLS", "y")],
      ["a", "b"],
    );
    expect(r.affected.find((a) => a.resourceId === "x")).toMatchObject({
      confidence: "confirmed",
      depth: 2,
      causes: ["a", "b"],
    });
  });

  it("with one resource it is the single impact", () => {
    const single = impact(edges, "sql01");
    const change = changeImpact(edges, ["sql01"]);
    // toEqual ignores the undefined `causes`.
    expect(change.affected.map((a) => ({ ...a, causes: undefined }))).toEqual(single.affected);
    expect(summarizeImpact(change, () => "APPLICATION").total).toBe(single.affected.length);
  });
});

describe("redundancy groups (M39)", () => {
  // app uses db; db runs on two replicas that are interchangeable; both
  // replicas run on the same hypervisor; report calls app.
  const edges = [
    e("1", "app", "USES_DATABASE", "db1"),
    e("2", "app", "USES_DATABASE", "db2"),
    e("3", "report", "CALLS", "app"),
    e("4", "db1", "RUNS_ON", "pve"),
    e("5", "db2", "RUNS_ON", "pve"),
    e("6", "cron", "CALLS", "db1", "detected"),
  ];
  const groups = new Map([
    ["db1", "db-cluster"],
    ["db2", "db-cluster"],
  ]);

  it("losing one member affects nothing behind it: its dependents lose redundancy", () => {
    const r = impact(edges, "db1", { groups });
    expect(r.affected).toEqual([]);
    expect(r.covered.map((c) => [c.resourceId, c.group, c.confidence])).toEqual([
      ["app", "db-cluster", "confirmed"],
      ["report", "db-cluster", "confirmed"],
      ["cron", "db-cluster", "detected"],
    ]);
    expect(r.degraded).toEqual([{ group: "db-cluster", down: ["db1"], up: ["db2"] }]);
  });

  it("a shared host takes the whole group down, and the failure flows on", () => {
    const r = impact(edges, "pve", { groups });
    expect(ids(r)).toEqual(["app", "cron", "db1", "db2", "report"]);
    expect(r.covered).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it("without groups (or a group of one) it is the plain blast radius", () => {
    expect(ids(impact(edges, "db1"))).toEqual(["app", "cron", "report"]);
    const alone = impact(edges, "db1", { groups: new Map([["db1", "solo"]]) });
    expect(ids(alone)).toEqual(["app", "cron", "report"]);
    expect(alone.covered).toEqual([]);
    expect(alone.degraded).toEqual([]);
  });

  it("changing every member at once takes the group down", () => {
    const one = changeImpact(edges, ["db1"], { groups });
    expect(one.affected).toEqual([]);
    expect(one.covered.map((c) => c.resourceId)).toEqual(["app", "report", "cron"]);
    const both = changeImpact(edges, ["db1", "db2"], { groups });
    expect(both.affected.map((a) => [a.resourceId, a.causes])).toEqual([
      ["app", ["db1", "db2"]],
      ["report", ["db1", "db2"]],
      ["cron", ["db1"]],
    ]);
    expect(both.covered).toEqual([]);
    expect(both.degraded).toEqual([]);
  });

  it("a dependent still reachable another way is affected, not covered", () => {
    const withBypass = [
      ...edges,
      e("7", "app", "DEPENDS_ON", "cache"),
      e("8", "cache", "RUNS_ON", "db1"),
    ];
    const r = impact(withBypass, "db1", { groups });
    // cache runs on db1 and is not redundant: it fails, and app with it.
    expect(ids(r)).toEqual(["app", "cache", "report"]);
    expect(r.covered.map((c) => c.resourceId)).toEqual(["cron"]);
  });
});
