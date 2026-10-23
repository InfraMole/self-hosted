// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { redundancyGroups, redundancyKey } from "./redundancy";

describe("redundancy groups", () => {
  it("matches names regardless of case and surrounding spaces", () => {
    expect(redundancyKey(" SQL-Cluster ")).toBe("sql-cluster");
  });

  it("maps only resources with a group", () => {
    const groups = redundancyGroups([
      { id: "a", redundancyGroup: "SQL" },
      { id: "b", redundancyGroup: "sql" },
      { id: "c", redundancyGroup: null },
      { id: "d", redundancyGroup: "  " },
      { id: "e" },
    ]);
    expect([...groups]).toEqual([
      ["a", "sql"],
      ["b", "sql"],
    ]);
  });
});
