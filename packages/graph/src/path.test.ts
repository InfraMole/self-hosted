// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "./graph";
import type { ImpactEdge } from "./impact";
import { describePath, findPath, pathSteps } from "./path";
import type { Confidence } from "./relationship-types";

const e = (
  id: string,
  from: string,
  type: GraphEdge["type"],
  to: string,
  confidence: Confidence | null = "confirmed",
): ImpactEdge => ({ id, from, to, type, confidence });

// PRODUCT.md example.
const product = [
  e("1", "db", "RUNS_ON", "sql01"),
  e("2", "billing", "USES_DATABASE", "db"),
  e("3", "portal", "CALLS", "billing"),
  e("4", "api", "USES_DATABASE", "db"),
  e("7", "sql01", "BACKS_UP_TO", "nas"),
  e("8", "pve", "HOSTS", "sql01"),
];

describe("findPath", () => {
  it("finds a dependency chain from a dependent to its dependency", () => {
    expect(findPath(product, "portal", "sql01")).toEqual({
      kind: "dependsOn",
      confidence: "confirmed",
      path: ["portal", "billing", "db", "sql01"],
      viaEdges: ["3", "2", "1"],
    });
  });

  it("follows failure propagation, not stored direction (HOSTS)", () => {
    expect(findPath(product, "db", "pve")).toMatchObject({
      kind: "dependsOn",
      path: ["db", "sql01", "pve"],
    });
  });

  it("reports the reverse direction as usedBy", () => {
    expect(findPath(product, "sql01", "portal")).toMatchObject({
      kind: "usedBy",
      path: ["sql01", "db", "billing", "portal"],
    });
  });

  it("links siblings and non-propagating edges as connected, never as a dependency", () => {
    expect(findPath(product, "api", "billing")).toMatchObject({
      kind: "connected",
      path: ["api", "db", "billing"],
    });
    expect(findPath(product, "nas", "db")).toMatchObject({
      kind: "connected",
      path: ["nas", "sql01", "db"],
    });
  });

  it("prefers a confirmed chain over a shorter unconfirmed one", () => {
    const edges = [
      e("a", "app", "CONNECTS_TO", "sql01", "detected"),
      e("b", "app", "USES_DATABASE", "db"),
      e("c", "db", "RUNS_ON", "sql01"),
    ];
    expect(findPath(edges, "app", "sql01")).toMatchObject({
      confidence: "confirmed",
      path: ["app", "db", "sql01"],
    });
    expect(findPath(edges.slice(0, 1), "app", "sql01")).toMatchObject({
      confidence: "detected",
      path: ["app", "sql01"],
    });
  });

  it("never uses ignored edges and returns null when not linked", () => {
    const edges = [e("a", "app", "RUNS_ON", "srv", null)];
    expect(findPath(edges, "app", "srv")).toBeNull();
    expect(findPath(product, "portal", "unknown")).toBeNull();
    expect(findPath(product, "db", "db")).toBeNull();
  });

  it("is cycle-safe and honours maxDepth", () => {
    const edges = [
      e("1", "a", "DEPENDS_ON", "b"),
      e("2", "b", "DEPENDS_ON", "a"),
      e("3", "b", "DEPENDS_ON", "c"),
    ];
    expect(findPath(edges, "a", "c")?.path).toEqual(["a", "b", "c"]);
    expect(findPath(edges, "a", "c", { maxDepth: 1 })).toBeNull();
  });
});

describe("describePath", () => {
  const name = (id: string) => id.toUpperCase();

  it("phrases each step from the resource it starts at", () => {
    const result = findPath(product, "db", "pve")!;
    expect(pathSteps(result, product).map((s) => s.phrase)).toEqual(["runs on", "runs on"]);
    expect(describePath(result, product, name)).toBe(
      ["DB depends on PVE:", "- DB runs on SQL01", "- SQL01 runs on PVE"].join("\n"),
    );
  });

  it("never states an unconfirmed chain as a dependency", () => {
    const edges = [e("a", "app", "CONNECTS_TO", "sql01", "detected")];
    expect(describePath(findPath(edges, "sql01", "app")!, edges, name)).toBe(
      [
        "APP may depend on SQL01 (detected, not confirmed):",
        "- SQL01 receives connections from APP (detected, not confirmed)",
      ].join("\n"),
    );
  });

  it("says when neither depends on the other", () => {
    expect(describePath(findPath(product, "api", "billing")!, product, name)).toMatch(
      /^API and BILLING are connected, but neither depends on the other:/,
    );
  });
});
