// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { fieldLabel, readableSummary } from "./change-fields";

describe("change history field names (M41)", () => {
  it("labels fields as people read them", () => {
    expect(fieldLabel("redundancyGroup")).toBe("redundancy group");
    expect(fieldLabel("metadata")).toBe("host details");
    expect(fieldLabel("somethingNew")).toBe("somethingNew");
  });

  it("rewrites summaries recorded with raw field names", () => {
    expect(readableSummary("Updated DC02: status, redundancyGroup")).toBe(
      "Updated DC02: status, redundancy group",
    );
    expect(readableSummary("Updated APP01 from file.csv: ownerContact, ipAddresses")).toBe(
      "Updated APP01 from file.csv: owner contact, IP addresses",
    );
  });

  it("leaves other summaries alone", () => {
    expect(readableSummary("Updated web: host details (agent)")).toBe(
      "Updated web: host details (agent)",
    );
    expect(readableSummary("Updated SQL01: IP 10.0.0.40 → 10.0.0.41")).toBe(
      "Updated SQL01: IP 10.0.0.40 → 10.0.0.41",
    );
    expect(readableSummary("Created DC01")).toBe("Created DC01");
    // Only lists of known field names are rewritten.
    expect(readableSummary("Updated a: b, notes")).toBe("Updated a: b, notes");
  });
});
