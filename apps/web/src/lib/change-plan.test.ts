// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  parseResourceIds,
  planHref,
  planNotify,
  planReportText,
  planText,
  rootsLabel,
  type PlanReport,
} from "./change-plan";
import {
  impactFields,
  impactRootsOf,
  sanitizeViewState,
  savedViewStateSchema,
} from "./map-view-state";

describe("plan a change — URL", () => {
  it("reads ids from a comma list or repeated params: valid, unique, capped at 50", () => {
    expect(parseResourceIds("a1,b2, a1,bad id,<x>")).toEqual(["a1", "b2"]);
    expect(parseResourceIds(["a", "b,c"])).toEqual(["a", "b", "c"]);
    expect(parseResourceIds(undefined)).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => `r${i}`).join(",");
    expect(parseResourceIds(many)).toHaveLength(50);
  });

  it("keeps free text to one bounded line", () => {
    expect(planText("  Patch\n SQL01  ", 120)).toBe("Patch SQL01");
    expect(planText("x".repeat(200), 80)).toHaveLength(80);
    expect(planText(["first", "second"], 80)).toBe("first");
  });

  it("builds the plan's address", () => {
    expect(planHref("acme", { ids: ["a", "b"], title: "Patch & reboot", when: "Sat" })).toBe(
      "/w/acme/plan?ids=a%2Cb&title=Patch+%26+reboot&when=Sat",
    );
    expect(planHref("acme", { ids: [] })).toBe("/w/acme/plan");
  });

  it("names the changed resources briefly", () => {
    expect(rootsLabel(["SQL01"])).toBe("SQL01");
    expect(rootsLabel(["SQL01", "APP02"])).toBe("SQL01 and APP02");
    expect(rootsLabel(["SQL01", "APP02", "DC01", "NAS01"])).toBe("SQL01, APP02 and 2 more");
  });
});

describe("plan a change — report", () => {
  const report: PlanReport = {
    workspace: "Acme",
    title: "Patch SQL01 and APP02",
    when: "Sat 25 Oct, 22:00",
    generatedAt: new Date("2026-10-22T10:00:00Z"),
    changed: [
      { name: "SQL01", typeLabel: "Server", owner: "DBA", ownerContact: "dba@x" },
      { name: "APP02", typeLabel: "Server", owner: null, ownerContact: null },
    ],
    affected: [
      {
        name: "CustomersDB",
        typeLabel: "Database",
        owner: "dba",
        ownerContact: null,
        confidence: "confirmed",
        depth: 1,
        causes: ["SQL01"],
        pathNames: ["SQL01", "CustomersDB"],
      },
      {
        name: "Portal",
        typeLabel: "Application",
        owner: null,
        ownerContact: null,
        confidence: "detected",
        depth: 2,
        causes: ["SQL01", "APP02"],
        pathNames: ["APP02", "API", "Portal"],
      },
    ],
  };

  it("warns the owners of what changes and of what could be affected", () => {
    expect(planNotify(report)).toEqual({
      groups: [
        {
          owner: "DBA",
          contact: "dba@x",
          resources: [{ name: "SQL01" }, { name: "CustomersDB", confidence: "confirmed" }],
        },
      ],
      unowned: ["APP02", "Portal"],
    });
  });

  it("is plain text for a change request, honest about certainty", () => {
    const text = planReportText(report);
    expect(text).toContain(
      "Change: Patch SQL01 and APP02\nWhen: Sat 25 Oct, 22:00\nWorkspace: Acme",
    );
    expect(text).toContain("- SQL01 (Server) · owner: DBA");
    expect(text).toContain("Could be affected (2):");
    expect(text).toContain("- CustomersDB (Database) — direct, through SQL01 · confirmed");
    expect(text).toContain(
      "- Portal (Application) — via API, through SQL01 and APP02 · detected, to verify",
    );
    expect(text).toContain("- DBA (dba@x): SQL01, CustomersDB");
    expect(text).toContain("- No owner recorded: APP02, Portal");
    expect(text).toContain("leads to verify, not confirmed dependencies");
    expect(text).not.toMatch(/will break/i);
  });

  it("says so when nothing recorded depends on the change", () => {
    const text = planReportText({ ...report, title: "", affected: [] });
    expect(text.startsWith("Change: Change to SQL01 and APP02")).toBe(true);
    expect(text).toContain("That does not prove nothing does.");
  });
});

describe("saved views with several impact roots (M34)", () => {
  const base = savedViewStateSchema.parse({});

  it("old views (one impact) and new ones (several) read the same way", () => {
    expect(impactRootsOf(base)).toEqual([]);
    expect(impactRootsOf({ ...base, impact: "a" })).toEqual(["a"]);
    expect(impactRootsOf({ ...base, ...impactFields(["a", "b"]) })).toEqual(["a", "b"]);
    expect(impactFields(["a"])).toEqual({ impact: "a", impacts: [] });
    expect(impactFields(["a", "b"])).toEqual({ impact: "a", impacts: ["a", "b"] });
  });

  it("drops changed resources the map no longer has", () => {
    const s = sanitizeViewState(
      { ...base, ...impactFields(["a", "gone", "b"]) },
      (id) => id !== "gone",
    );
    expect(s.impacts).toEqual(["a", "b"]);
  });
});
