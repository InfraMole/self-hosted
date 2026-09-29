// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepts same-origin paths", () => {
    expect(safeNext("/invite/dmp_inv_abc")).toBe("/invite/dmp_inv_abc");
    expect(safeNext("/w/acme/library?type=SERVER")).toBe("/w/acme/library?type=SERVER");
  });
  it("rejects anything that could leave the origin", () => {
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "evil",
      "/a\nb",
      "",
      undefined,
      ["/x"],
    ])
      expect(safeNext(bad as string)).toBeNull();
  });
});
