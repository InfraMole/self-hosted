// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { isValidSlug, slugify, workspaceSlugBase } from "./slug";

describe("slugify", () => {
  it.each([
    ["Acme Corp", "acme-corp"],
    ["  Acme -- Corp  ", "acme-corp"],
    ["Café Ñandú", "cafe-nandu"],
    ["Prod/EU #1", "prod-eu-1"],
    ["日本", ""],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("workspaceSlugBase", () => {
  it("always returns a valid slug", () => {
    for (const name of ["Acme", "A", "IT", "日本", "!!!", "x".repeat(200)]) {
      expect(isValidSlug(workspaceSlugBase(name))).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  it.each(["abc", "acme-corp", "a1-b2"])("accepts %s", (s) => expect(isValidSlug(s)).toBe(true));
  it.each(["ab", "-abc", "abc-", "ABC", "a_b", "a b", "x".repeat(49), "../etc"])(
    "rejects %s",
    (s) => expect(isValidSlug(s)).toBe(false),
  );
});
