// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { dependencyDirection, neighbourhood, perspective, type GraphEdge } from "./graph";
import {
  RELATIONSHIP_TYPES,
  RELATIONSHIP_TYPE_INFO,
  edgeConfidence,
  isRelationshipType,
} from "./relationship-types";

const e = (id: string, from: string, type: GraphEdge["type"], to: string): GraphEdge => ({
  id,
  from,
  to,
  type,
});

describe("relationship type registry", () => {
  it("has an entry for every type", () => {
    expect(Object.keys(RELATIONSHIP_TYPE_INFO).sort()).toEqual([...RELATIONSHIP_TYPES].sort());
  });

  it("encodes the propagation table from DATA_MODEL.md", () => {
    const byPropagation = (p: string) =>
      RELATIONSHIP_TYPES.filter((t) => RELATIONSHIP_TYPE_INFO[t].propagation === p).sort();
    expect(byPropagation("forward")).toEqual(["HOSTS"]);
    expect(byPropagation("none")).toEqual(["BACKS_UP_TO", "MONITORED_BY", "OTHER"]);
  });

  it("RUNS_ON and HOSTS are inverses", () => {
    expect(RELATIONSHIP_TYPE_INFO.RUNS_ON.inverseLabel).toBe(RELATIONSHIP_TYPE_INFO.HOSTS.label);
    expect(RELATIONSHIP_TYPE_INFO.HOSTS.inverseLabel).toBe(RELATIONSHIP_TYPE_INFO.RUNS_ON.label);
  });

  it("validates type names", () => {
    expect(isRelationshipType("CALLS")).toBe(true);
    expect(isRelationshipType("calls")).toBe(false);
  });
});

describe("edgeConfidence", () => {
  it("never presents unconfirmed edges as confirmed", () => {
    expect(edgeConfidence("CONFIRMED", "MANUAL")).toBe("confirmed");
    expect(edgeConfidence("CONFIRMED", "DETECTED")).toBe("confirmed");
    expect(edgeConfidence("UNCONFIRMED", "DETECTED")).toBe("detected");
    expect(edgeConfidence("UNCONFIRMED", "INFERRED")).toBe("inferred");
    expect(edgeConfidence("IGNORED", "MANUAL")).toBeNull();
  });
});

describe("perspective", () => {
  it("reverse types: from depends on to", () => {
    const edge = e("1", "api", "USES_DATABASE", "sql");
    expect(perspective(edge, "api")).toEqual({
      bucket: "dependsOn",
      otherId: "sql",
      phrase: "uses database",
    });
    expect(perspective(edge, "sql")).toEqual({
      bucket: "usedBy",
      otherId: "api",
      phrase: "database for",
    });
  });

  it("forward types: to depends on from (HOSTS)", () => {
    const edge = e("1", "pve", "HOSTS", "vm");
    expect(perspective(edge, "vm")).toEqual({
      bucket: "dependsOn",
      otherId: "pve",
      phrase: "runs on",
    });
    expect(perspective(edge, "pve")).toEqual({ bucket: "usedBy", otherId: "vm", phrase: "hosts" });
  });

  it("non-propagating types are related", () => {
    const edge = e("1", "app", "MONITORED_BY", "zabbix");
    expect(perspective(edge, "app").bucket).toBe("related");
    expect(perspective(edge, "zabbix")).toMatchObject({ bucket: "related", phrase: "monitors" });
  });
});

describe("dependencyDirection", () => {
  it("orients edges dependent -> dependency", () => {
    expect(dependencyDirection(e("1", "vm", "RUNS_ON", "pve"))).toEqual({
      dependent: "vm",
      dependency: "pve",
    });
    expect(dependencyDirection(e("1", "pve", "HOSTS", "vm"))).toEqual({
      dependent: "vm",
      dependency: "pve",
    });
    expect(dependencyDirection(e("1", "a", "BACKS_UP_TO", "nas"))).toBeNull();
  });
});

describe("neighbourhood", () => {
  //   web --CALLS--> api --USES_DATABASE--> db --RUNS_ON--> sql
  //   mobile --CALLS--> api ;  pve --HOSTS--> sql ;  sql --MONITORED_BY--> zabbix
  const edges = [
    e("1", "web", "CALLS", "api"),
    e("2", "mobile", "CALLS", "api"),
    e("3", "api", "USES_DATABASE", "db"),
    e("4", "db", "RUNS_ON", "sql"),
    e("5", "pve", "HOSTS", "sql"),
    e("6", "sql", "MONITORED_BY", "zabbix"),
  ];
  const sorted = (s: Set<string>) => [...s].sort();

  it("dependsOn follows dependencies (including forward HOSTS)", () => {
    expect(sorted(neighbourhood(edges, "api", { depth: 5, direction: "dependsOn" }))).toEqual([
      "api",
      "db",
      "pve",
      "sql",
    ]);
  });

  it("usedBy follows dependents", () => {
    expect(sorted(neighbourhood(edges, "sql", { depth: 5, direction: "usedBy" }))).toEqual([
      "api",
      "db",
      "mobile",
      "sql",
      "web",
    ]);
  });

  it("respects depth", () => {
    expect(sorted(neighbourhood(edges, "sql", { depth: 1, direction: "usedBy" }))).toEqual([
      "db",
      "sql",
    ]);
    expect(sorted(neighbourhood(edges, "sql", { depth: 0, direction: "both" }))).toEqual(["sql"]);
  });

  it("adds informational neighbours of the start node only, and never traverses them", () => {
    // zabbix is related to sql, not to api: focusing api must not pull it in.
    expect(
      neighbourhood(edges, "api", { depth: 5, direction: "both", includeRelated: true }).has(
        "zabbix",
      ),
    ).toBe(false);
  });

  it("does not traverse non-propagating edges unless asked", () => {
    expect(neighbourhood(edges, "sql", { depth: 5, direction: "both" }).has("zabbix")).toBe(false);
    expect(
      neighbourhood(edges, "sql", { depth: 1, direction: "both", includeRelated: true }).has(
        "zabbix",
      ),
    ).toBe(true);
  });

  it("is cycle-safe", () => {
    const cyclic = [
      e("1", "a", "CALLS", "b"),
      e("2", "b", "CALLS", "c"),
      e("3", "c", "CALLS", "a"),
    ];
    expect(sorted(neighbourhood(cyclic, "a", { depth: 100, direction: "both" }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
