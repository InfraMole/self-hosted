// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildIpIndex,
  planDiscovery,
  resolveRemote,
  type FactInput,
  type RelationshipInput,
  type ResourceIps,
} from "./plan";
import { guessProtocol } from "./protocols";

const t = new Date("2026-09-28T10:00:00Z");
let n = 0;
const fact = (over: Partial<FactInput>): FactInput => ({
  id: `f${++n}`,
  sourceResourceId: "app01",
  direction: "OUTBOUND",
  remoteIp: "10.0.0.40",
  port: 1433,
  processName: "w3wp.exe",
  sampleCount: 10,
  firstSeenAt: t,
  lastSeenAt: t,
  remoteResourceId: null,
  ...over,
});

const resources: ResourceIps[] = [
  { id: "app01", ipAddresses: ["10.0.0.23"] },
  { id: "sql01", ipAddresses: ["10.0.0.40"] },
  { id: "dc01", ipAddresses: ["10.0.0.10", "FE80::10"] },
  { id: "vip-a", ipAddresses: ["10.0.0.99"] },
  { id: "vip-b", ipAddresses: ["10.0.0.99"] },
];

describe("resolveRemote", () => {
  const index = buildIpIndex(resources);
  it("resolves a unique owner, case-insensitively", () => {
    expect(resolveRemote(index, "10.0.0.40", "app01")).toBe("sql01");
    expect(resolveRemote(index, "fe80::10", "app01")).toBe("dc01");
  });
  it("never resolves ambiguous, unknown or self IPs", () => {
    expect(resolveRemote(index, "10.0.0.99", "app01")).toBeNull();
    expect(resolveRemote(index, "8.8.8.8", "app01")).toBeNull();
    expect(resolveRemote(index, "10.0.0.23", "app01")).toBeNull();
  });
});

describe("planDiscovery", () => {
  it("suggests an outbound connection and records the resolution", () => {
    const f = fact({});
    const plan = planDiscovery([f], resources, []);
    expect(plan.resolutions).toEqual([{ factId: f.id, remoteResourceId: "sql01" }]);
    expect(plan.creates).toEqual([{ from: "app01", to: "sql01", facts: [f] }]);
    expect(plan.evidence).toEqual([]);
  });

  it("maps inbound facts client -> server (the reporting host)", () => {
    const f = fact({
      sourceResourceId: "sql01",
      direction: "INBOUND",
      remoteIp: "10.0.0.23",
      port: 1433,
    });
    expect(planDiscovery([f], resources, []).creates).toEqual([
      { from: "app01", to: "sql01", facts: [f] },
    ]);
  });

  it("groups facts of the same pair (both agents, several ports) into one suggestion", () => {
    const out = fact({});
    const inb = fact({ sourceResourceId: "sql01", direction: "INBOUND", remoteIp: "10.0.0.23" });
    const other = fact({ port: 1434, processName: "" });
    const plan = planDiscovery([out, inb, other], resources, []);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]!.facts.map((x) => x.id)).toEqual([out.id, inb.id, other.id]);
  });

  it("requires minimum evidence", () => {
    expect(planDiscovery([fact({ sampleCount: 1 })], resources, []).creates).toEqual([]);
  });

  it("adds evidence to an existing same-direction relationship, preferring confirmed", () => {
    const rels: RelationshipInput[] = [
      { id: "r-unconf", from: "app01", to: "sql01", status: "UNCONFIRMED" },
      { id: "r-conf", from: "app01", to: "sql01", status: "CONFIRMED" },
    ];
    const f = fact({});
    const plan = planDiscovery([f], resources, rels);
    expect(plan.creates).toEqual([]);
    expect(plan.evidence).toEqual([{ relationshipId: "r-conf", facts: [f] }]);
  });

  it("never re-suggests or touches an ignored pair", () => {
    const rels: RelationshipInput[] = [{ id: "r", from: "app01", to: "sql01", status: "IGNORED" }];
    const plan = planDiscovery([fact({})], resources, rels);
    expect(plan.creates).toEqual([]);
    expect(plan.evidence).toEqual([]);
  });

  it("does not suggest when a human described the pair the other way round", () => {
    const rels: RelationshipInput[] = [
      { id: "r", from: "sql01", to: "app01", status: "CONFIRMED" },
    ];
    expect(planDiscovery([fact({})], resources, rels).creates).toEqual([]);
  });

  it("leaves unknown endpoints unresolved and un-suggested", () => {
    const f = fact({ remoteIp: "52.1.2.3", remoteResourceId: null });
    const plan = planDiscovery([f], resources, []);
    expect(plan).toEqual({ resolutions: [], creates: [], evidence: [] });
  });

  it("clears a stale resolution when the IP no longer belongs to that resource", () => {
    const f = fact({ remoteIp: "10.0.0.77", remoteResourceId: "sql01" });
    expect(planDiscovery([f], resources, []).resolutions).toEqual([
      { factId: f.id, remoteResourceId: null },
    ]);
  });

  it("skips facts whose host resource is gone or archived", () => {
    expect(planDiscovery([fact({ sourceResourceId: "archived-host" })], resources, [])).toEqual({
      resolutions: [],
      creates: [],
      evidence: [],
    });
  });
});

describe("guessProtocol", () => {
  it("labels well-known ports and suggests a type", () => {
    expect(guessProtocol(1433)).toEqual({ name: "MSSQL", suggestedType: "USES_DATABASE" });
    expect(guessProtocol(389)?.suggestedType).toBe("AUTHENTICATES_WITH");
    expect(guessProtocol(49152)).toBeNull();
  });
});
