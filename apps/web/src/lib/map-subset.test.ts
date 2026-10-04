// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { viewSubset, type SubsetEdge, type SubsetNode } from "./map-subset";

const n = (id: string, type = "APPLICATION", environment: string | null = "PRODUCTION") =>
  ({ id, type, environment }) satisfies SubsetNode;
const e = (
  id: string,
  from: string,
  type: SubsetEdge["type"],
  to: string,
  status: SubsetEdge["status"] = "CONFIRMED",
  origin: SubsetEdge["origin"] = "MANUAL",
): SubsetEdge => ({ id, from, to, type, status, origin });

const nodes = [
  n("portal"),
  n("billing"),
  n("db", "DATABASE"),
  n("sql01", "SERVER"),
  n("nas", "STORAGE", null),
  n("dev-app", "APPLICATION", "DEVELOPMENT"),
];
const edges = [
  e("1", "db", "RUNS_ON", "sql01"),
  e("2", "billing", "USES_DATABASE", "db"),
  e("3", "portal", "CALLS", "billing", "UNCONFIRMED", "DETECTED"),
  e("4", "sql01", "BACKS_UP_TO", "nas"),
  e("5", "dev-app", "DEPENDS_ON", "db", "IGNORED", "DETECTED"),
];
const base = {
  type: null,
  environment: null,
  showUnconfirmed: false,
  showInformational: true,
  focus: null,
  impact: null,
};
const ids = (r: { nodes: { id: string }[]; edges: { id: string }[] }) => ({
  nodes: r.nodes.map((x) => x.id),
  edges: r.edges.map((x) => x.id),
});

describe("viewSubset", () => {
  it("whole map: confirmed and informational edges, never ignored ones", () => {
    expect(ids(viewSubset(nodes, edges, base))).toEqual({
      nodes: ["portal", "billing", "db", "sql01", "nas", "dev-app"],
      edges: ["1", "2", "4"],
    });
    expect(ids(viewSubset(nodes, edges, { ...base, showUnconfirmed: true })).edges).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("filters by type and environment", () => {
    expect(ids(viewSubset(nodes, edges, { ...base, environment: "DEVELOPMENT" }))).toEqual({
      nodes: ["dev-app"],
      edges: [],
    });
    expect(ids(viewSubset(nodes, edges, { ...base, type: "SERVER" })).nodes).toEqual(["sql01"]);
  });

  it("focus: the neighbourhood only", () => {
    const r = viewSubset(nodes, edges, {
      ...base,
      showInformational: false,
      focus: { id: "db", depth: 1, direction: "both" },
    });
    expect(ids(r)).toEqual({ nodes: ["billing", "db", "sql01"], edges: ["1", "2"] });
  });

  it("impact: the failing resource and what could be affected, unconfirmed included", () => {
    expect(ids(viewSubset(nodes, edges, { ...base, impact: "sql01" }))).toEqual({
      nodes: ["portal", "billing", "db", "sql01"],
      edges: ["1", "2", "3"],
    });
  });

  it("ignores focus and impact on resources that are gone", () => {
    expect(viewSubset(nodes, edges, { ...base, impact: "gone" }).nodes).toHaveLength(6);
    expect(
      viewSubset(nodes, edges, { ...base, focus: { id: "gone", depth: 2, direction: "both" } })
        .nodes,
    ).toHaveLength(6);
  });
});
