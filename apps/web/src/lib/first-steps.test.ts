// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { firstSteps } from "./first-steps";

const facts = { resources: 0, pendingSuggestions: 0, confirmedRelationships: 0, showcase: null };

describe("first steps", () => {
  it("go from data to what this viewer has seen", () => {
    const done = (f: typeof facts, seen = {}) =>
      firstSteps(f, seen)
        .filter((s) => s.done)
        .map((s) => s.id);
    expect(done(facts)).toEqual([]);
    expect(done({ ...facts, resources: 3, pendingSuggestions: 2 })).toEqual(["add"]);
    expect(done({ ...facts, resources: 3, confirmedRelationships: 1 })).toEqual(["add", "confirm"]);
    expect(
      done({ ...facts, resources: 3, confirmedRelationships: 1 }, { map: true, impact: true }),
    ).toEqual(["add", "confirm", "map", "impact"]);
  });
});
