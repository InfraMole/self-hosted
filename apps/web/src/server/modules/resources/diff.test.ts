// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { diffResource, updateSummary, type ResourceSnapshot } from "./diff";

const base: ResourceSnapshot = {
  name: "APP01",
  type: "SERVER",
  environment: "PRODUCTION",
  criticality: null,
  status: "ACTIVE",
  description: null,
  notes: null,
  owner: null,
  ownerContact: null,
  tags: ["web"],
  links: [],
  metadata: { ipAddresses: ["10.0.0.23"] },
};

describe("diffResource", () => {
  it("returns an empty diff when nothing changed", () => {
    expect(diffResource(base, { ...base, tags: ["web"] })).toEqual({});
  });

  it("reports changed fields with before/after", () => {
    const diff = diffResource(base, {
      ...base,
      environment: "STAGING",
      metadata: { ipAddresses: ["10.0.0.24"] },
    });
    expect(diff).toEqual({
      environment: ["PRODUCTION", "STAGING"],
      metadata: [{ ipAddresses: ["10.0.0.23"] }, { ipAddresses: ["10.0.0.24"] }],
    });
    expect(updateSummary("APP01", diff)).toBe("Updated APP01: environment, metadata");
  });

  it("ignores object key order (JSONB reorders keys)", () => {
    expect(
      diffResource(
        { ...base, metadata: { ipAddresses: ["10.0.0.23"], hostname: "app01", os: "Windows" } },
        { ...base, metadata: { os: "Windows", hostname: "app01", ipAddresses: ["10.0.0.23"] } },
      ),
    ).toEqual({});
  });

  it("treats undefined and null as equal", () => {
    expect(diffResource(base, { ...base, description: undefined })).toEqual({});
  });

  it("bounds long text values", () => {
    const diff = diffResource(base, { ...base, notes: "x".repeat(1000) });
    const after = diff.notes![1] as string;
    expect(after.length).toBeLessThanOrEqual(201);
  });
});
