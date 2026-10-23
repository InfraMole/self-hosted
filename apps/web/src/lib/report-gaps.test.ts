// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { reportGaps } from "./report-gaps";

describe("reportGaps (M39)", () => {
  it("is empty for a complete report", () => {
    expect(reportGaps([], false)).toEqual([]);
  });

  it("names each failed collector with its category, and the limits", () => {
    expect(
      reportGaps(
        [
          { collector: "docker", error: "failed" },
          { collector: "services", error: "access-denied" },
        ],
        true,
      ),
    ).toEqual([
      "Could not read Docker containers (failed), services (access denied).",
      "Reached the report limits — some items were left out.",
    ]);
  });
});
