// SPDX-License-Identifier: AGPL-3.0-only
/** Resilience report (M44, ADR-060): ranking, single points of failure, recovery order. */
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "./graph";
import { impact, impactRanking, singlePointsOfFailure, type ImpactEdge } from "./impact";
import { recoveryOrder } from "./recovery";
import type { Confidence } from "./relationship-types";

const e = (
  id: string,
  from: string,
  type: GraphEdge["type"],
  to: string,
  confidence: Confidence | null = "confirmed",
): ImpactEdge => ({ id, from, to, type, confidence });

// db runs on sql01 (on a NAS); two apps use db; portal calls one of them; a
// monitoring edge never propagates; "lonely" has no relationships.
const nodes = ["sql01", "nas", "db", "billing", "reports", "portal", "zabbix", "lonely"];
const edges = [
  e("1", "sql01", "RUNS_ON", "nas"),
  e("2", "db", "RUNS_ON", "sql01"),
  e("3", "billing", "USES_DATABASE", "db"),
  e("4", "reports", "USES_DATABASE", "db", "detected"),
  e("5", "portal", "CALLS", "billing"),
  e("6", "sql01", "MONITORED_BY", "zabbix"),
  e("7", "portal", "CALLS", "reports", null), // ignored
];
const row = (ranking: ReturnType<typeof impactRanking>, id: string) =>
  ranking.find((r) => r.resourceId === id)!;

describe("impactRanking", () => {
  it("counts what each resource could affect, matching impact()", () => {
    const ranking = impactRanking(nodes, edges);
    for (const id of nodes)
      expect(row(ranking, id).couldAffect).toBe(impact(edges, id).affected.length);
    expect(ranking.map((r) => r.resourceId).slice(0, 3)).toEqual(["nas", "sql01", "db"]);
    expect(row(ranking, "nas")).toEqual({
      resourceId: "nas",
      couldAffect: 5,
      byConfidence: { confirmed: 4, detected: 1, inferred: 0 },
      covered: 0,
      dependsOn: 0,
    });
  });

  it("reads the same computation backwards: what could affect each resource", () => {
    const ranking = impactRanking(nodes, edges);
    expect(row(ranking, "portal").dependsOn).toBe(4); // billing, db, sql01, nas
    expect(row(ranking, "reports").dependsOn).toBe(3);
    expect(row(ranking, "zabbix").dependsOn).toBe(0); // monitoring does not propagate
    expect(row(ranking, "lonely")).toMatchObject({ couldAffect: 0, dependsOn: 0 });
  });

  it("follows the confidence filter and ignores edges leaving the scope", () => {
    const confirmed = impactRanking(nodes, edges, { include: ["confirmed"] });
    expect(row(confirmed, "db").couldAffect).toBe(2); // billing, portal — not reports
    const scoped = impactRanking(["db", "billing", "portal"], edges);
    expect(row(scoped, "db").couldAffect).toBe(2);
    expect(row(scoped, "portal").dependsOn).toBe(2);
    expect(scoped.map((r) => r.resourceId)).not.toContain("sql01");
  });

  it("counts what redundancy covers apart, as the impact page does", () => {
    const replicated = [
      e("1", "app", "USES_DATABASE", "db1"),
      e("2", "app", "USES_DATABASE", "db2"),
      e("3", "report", "CALLS", "app"),
      e("4", "db1", "RUNS_ON", "pve"),
      e("5", "db2", "RUNS_ON", "pve"),
    ];
    const groups = new Map([
      ["db1", "db-cluster"],
      ["db2", "db-cluster"],
    ]);
    const ranking = impactRanking(["app", "db1", "db2", "report", "pve"], replicated, { groups });
    expect(row(ranking, "db1")).toMatchObject({ couldAffect: 0, covered: 2 });
    expect(row(ranking, "pve")).toMatchObject({ couldAffect: 4, covered: 0 });
    expect(row(ranking, "app").dependsOn).toBe(1); // only pve takes both replicas down
    expect(singlePointsOfFailure(ranking, groups).map((r) => r.resourceId)).toEqual(["pve", "app"]);
  });
  it("ranks only the given roots when asked, still over the whole subgraph", () => {
    const some = impactRanking(nodes, edges, { roots: ["db", "portal", "unknown"] });
    expect(some.map((r) => [r.resourceId, r.couldAffect])).toEqual([
      ["db", 3],
      ["portal", 0],
    ]);
  });
});

describe("singlePointsOfFailure", () => {
  it("lists resources that could affect something and have no redundancy group", () => {
    const ranking = impactRanking(nodes, edges);
    expect(singlePointsOfFailure(ranking).map((r) => r.resourceId)).toEqual([
      "nas",
      "sql01",
      "db",
      "billing",
    ]);
    // A group of one is no redundancy.
    expect(
      singlePointsOfFailure(ranking, new Map([["db", "solo"]])).map((r) => r.resourceId),
    ).toContain("db");
  });
});

describe("recoveryOrder", () => {
  const names = (o: ReturnType<typeof recoveryOrder>) => o.waves.map((w) => w.map((s) => s.ids));

  it("brings dependencies back before what depends on them", () => {
    const order = recoveryOrder(nodes, edges);
    expect(names(order)).toEqual([
      [["nas"]],
      [["sql01"]],
      [["db"]],
      [["billing"], ["reports"]],
      [["portal"]],
    ]);
    // Monitoring does not propagate failure; "lonely" has no relationships.
    expect(order.unconnected).toEqual(["lonely", "zabbix"]);
  });

  it("puts a step in the earliest wave after everything it needs", () => {
    const order = recoveryOrder(
      ["a", "b", "c", "d"],
      [
        e("1", "a", "DEPENDS_ON", "b"),
        e("2", "b", "DEPENDS_ON", "c"),
        e("3", "a", "DEPENDS_ON", "d"),
      ],
    );
    expect(names(order)).toEqual([[["c"], ["d"]], [["b"]], [["a"]]]);
  });

  it("shows circular dependencies as one step whose inner order is unknown", () => {
    const order = recoveryOrder(
      ["a", "b", "c", "app"],
      [
        e("1", "a", "DEPENDS_ON", "b"),
        e("2", "b", "DEPENDS_ON", "c"),
        e("3", "c", "DEPENDS_ON", "a"),
        e("4", "app", "DEPENDS_ON", "a"),
      ],
    );
    expect(order.waves).toEqual([
      [{ ids: ["a", "b", "c"], circular: true }],
      [{ ids: ["app"], circular: false }],
    ]);
  });

  it("keeps the members of a redundancy group in one step", () => {
    const order = recoveryOrder(
      ["app", "db1", "db2", "pve1", "pve2"],
      [
        e("1", "app", "USES_DATABASE", "db1"),
        e("2", "app", "USES_DATABASE", "db2"),
        e("3", "db1", "RUNS_ON", "pve1"),
        e("4", "db2", "RUNS_ON", "pve2"),
      ],
      {
        groups: new Map([
          ["db1", "db-cluster"],
          ["db2", "db-cluster"],
        ]),
      },
    );
    expect(order.waves).toEqual([
      [
        { ids: ["pve1"], circular: false },
        { ids: ["pve2"], circular: false },
      ],
      [{ ids: ["db1", "db2"], circular: false, group: "db-cluster" }],
      [{ ids: ["app"], circular: false }],
    ]);
  });

  it("follows the confidence filter and the scope", () => {
    expect(
      names(recoveryOrder(nodes, edges, { include: ["confirmed"] })).flat(),
    ).not.toContainEqual(["reports"]);
    const scoped = recoveryOrder(["db", "billing"], edges);
    expect(names(scoped)).toEqual([[["db"]], [["billing"]]]);
  });

  it("handles long chains without recursion limits", () => {
    const n = 20_000;
    const chain = Array.from({ length: n - 1 }, (_, i) =>
      e(String(i), `r${i + 1}`, "DEPENDS_ON", `r${i}`),
    );
    const order = recoveryOrder(
      Array.from({ length: n }, (_, i) => `r${i}`),
      chain,
    );
    expect(order.waves).toHaveLength(n);
    expect(order.waves[0]![0]!.ids).toEqual(["r0"]);
  });
});
