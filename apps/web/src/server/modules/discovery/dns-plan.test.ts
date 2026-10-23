// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { planDnsSuggestions, type HostRelationship } from "./dns-plan";
import { buildIpIndex } from "./plan";

const index = buildIpIndex([
  { id: "host", ipAddresses: ["10.0.0.23"] },
  { id: "dns1", ipAddresses: ["10.0.0.53"] },
  { id: "dns2", ipAddresses: ["10.0.0.54"] },
  { id: "vip-a", ipAddresses: ["10.0.0.99"] },
  { id: "vip-b", ipAddresses: ["10.0.0.99"] },
]);

const rel = (r: Partial<HostRelationship> & { id: string; to: string }): HostRelationship => ({
  type: "CONNECTS_TO",
  status: "UNCONFIRMED",
  dns: false,
  other: false,
  ...r,
});

describe("planDnsSuggestions (M39)", () => {
  it("suggests a dependency on each resolver that matches exactly one resource", () => {
    const plan = planDnsSuggestions(
      "host",
      ["10.0.0.53", "10.0.0.54", "10.0.0.99", "192.0.2.1", "10.0.0.23"],
      index,
      [],
    );
    // Ambiguous (shared VIP), unknown and the host's own address are skipped.
    expect(plan).toEqual({ create: ["dns1", "dns2"], refresh: [], drop: [], strip: [] });
  });

  it("reuses any existing relationship of the pair — confirmed, observed or ignored", () => {
    const plan = planDnsSuggestions("host", ["10.0.0.53", "10.0.0.54"], index, [
      rel({ id: "r1", to: "dns1", status: "IGNORED" }),
      rel({ id: "r2", to: "dns2", type: "CONNECTS_TO", other: true }),
      rel({ id: "r3", to: "dns2", type: "DEPENDS_ON", status: "CONFIRMED" }),
    ]);
    expect(plan).toEqual({ create: [], refresh: ["r1", "r3"], drop: [], strip: [] });
  });

  it("drops unreviewed DNS-only suggestions once the resolver is gone, keeps the rest", () => {
    const plan = planDnsSuggestions("host", ["10.0.0.54"], index, [
      rel({ id: "only-dns", to: "dns1", type: "DEPENDS_ON", dns: true }),
      rel({ id: "also-seen", to: "vip-a", dns: true, other: true }),
      rel({ id: "confirmed", to: "vip-b", status: "CONFIRMED", dns: true }),
      rel({ id: "kept", to: "dns2", type: "DEPENDS_ON", dns: true }),
    ]);
    expect(plan).toEqual({
      create: [],
      refresh: ["kept"],
      drop: ["only-dns"],
      strip: ["also-seen", "confirmed"],
    });
  });

  it("honours exclusion rules on port 53 or on either resource", () => {
    const rules = [{ id: "r", port: 53, processName: null, resourceId: null }];
    const plan = planDnsSuggestions(
      "host",
      ["10.0.0.53"],
      index,
      [rel({ id: "a", to: "dns1", type: "DEPENDS_ON", dns: true })],
      rules,
    );
    expect(plan).toEqual({ create: [], refresh: [], drop: ["a"], strip: [] });
    const byResource = [{ id: "r", port: null, processName: null, resourceId: "dns2" }];
    expect(
      planDnsSuggestions("host", ["10.0.0.53", "10.0.0.54"], index, [], byResource).create,
    ).toEqual(["dns1"]);
  });

  it("an empty list (no resolver configured) clears every DNS suggestion", () => {
    const plan = planDnsSuggestions("host", [], index, [
      rel({ id: "a", to: "dns1", type: "DEPENDS_ON", dns: true }),
    ]);
    expect(plan.drop).toEqual(["a"]);
  });
});
