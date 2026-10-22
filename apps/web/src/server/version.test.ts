// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { agentBehind, compareVersions } from "./version";

describe("compareVersions", () => {
  it("orders by major, minor, patch — numerically", () => {
    expect(compareVersions("0.19.0", "0.18.9")).toBeGreaterThan(0);
    expect(compareVersions("0.18.10", "0.18.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.18.2", "0.18.2")).toBe(0);
    expect(compareVersions("0.18.1", "0.18.2")).toBeLessThan(0);
  });
});

describe("agentBehind (M36)", () => {
  it("flags only agents older than a known latest release", () => {
    expect(agentBehind("0.6.0", "0.6.1")).toBe(true);
    expect(agentBehind("v0.6.0", "0.6.1")).toBe(true);
    expect(agentBehind("0.6.1", "0.6.1")).toBe(false);
    expect(agentBehind("0.7.0", "0.6.1")).toBe(false);
    expect(agentBehind("0.6.0", null)).toBe(false); // check off or offline
    expect(agentBehind("dev", "0.6.1")).toBe(false); // source builds
  });
});
