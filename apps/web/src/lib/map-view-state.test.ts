// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { sameViewState, sanitizeViewState, savedViewStateSchema } from "./map-view-state";

const base = savedViewStateSchema.parse({});

describe("saved view state", () => {
  it("drops what points to resources the map no longer has", () => {
    const s = sanitizeViewState(
      {
        ...base,
        focus: { id: "gone", depth: 2, direction: "both" },
        impact: "gone",
        groups: { a: true, gone: false },
        pinned: {
          a: { x: 1, y: 2, parent: null },
          b: { x: 1, y: 2, parent: "gone" },
          gone: { x: 0, y: 0, parent: null },
        },
      },
      (id) => id !== "gone",
    );
    expect(s.focus).toBeNull();
    expect(s.impact).toBeNull();
    expect(s.groups).toEqual({ a: true });
    expect(Object.keys(s.pinned)).toEqual(["a"]);
  });

  it("ignores key order and sub-pixel moves when comparing", () => {
    const a = {
      ...base,
      pinned: { a: { x: 1, y: 2, parent: null }, b: { x: 3, y: 4, parent: null } },
    };
    const b = {
      ...base,
      pinned: { b: { x: 3.2, y: 4, parent: null }, a: { x: 1, y: 2, parent: null } },
    };
    expect(sameViewState(a, b)).toBe(true);
    expect(sameViewState(a, { ...b, groupMode: "collapsed" })).toBe(false);
  });

  it("refuses unbounded or odd input", () => {
    expect(
      savedViewStateSchema.safeParse({ pinned: { "a b": { x: 0, y: 0, parent: null } } }).success,
    ).toBe(false);
    expect(
      savedViewStateSchema.safeParse({ pinned: { a: { x: Infinity, y: 0, parent: null } } })
        .success,
    ).toBe(false);
    expect(
      savedViewStateSchema.safeParse({ focus: { id: "a", depth: 7, direction: "both" } }).success,
    ).toBe(false);
  });
});
