// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { compareVersions } from "./version";

describe("compareVersions", () => {
  it("orders by major, minor, patch — numerically", () => {
    expect(compareVersions("0.19.0", "0.18.9")).toBeGreaterThan(0);
    expect(compareVersions("0.18.10", "0.18.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.18.2", "0.18.2")).toBe(0);
    expect(compareVersions("0.18.1", "0.18.2")).toBeLessThan(0);
  });
});
