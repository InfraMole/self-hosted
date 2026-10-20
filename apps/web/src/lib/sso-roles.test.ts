// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { emailDomain, formatGroupRules, groupsFrom, parseGroupRules, roleFor } from "./sso-roles";

describe("group rules", () => {
  it("parse one rule per line, ignoring blanks and comments", () => {
    const parsed = parseGroupRules("# who gets what\nIT-Admins = admin\n\nService Desk: VIEWER\n");
    expect(parsed).toEqual({
      ok: true,
      rules: [
        { group: "IT-Admins", role: "ADMIN" },
        { group: "Service Desk", role: "VIEWER" },
      ],
    });
    expect(formatGroupRules((parsed as unknown as { rules: never[] }).rules)).toBe(
      "IT-Admins = admin\nService Desk = viewer",
    );
  });

  it("refuse unknown roles — a directory never makes owners", () => {
    expect(parseGroupRules("Admins = owner")).toEqual({
      ok: false,
      error: 'Line 1: write "group = viewer | member | admin".',
    });
  });
});

describe("groups from claims and attributes", () => {
  it("read arrays, comma lists, distinguished names and Keycloak paths", () => {
    expect(groupsFrom(["a", " b "])).toEqual(["a", "b"]);
    expect(groupsFrom("a,b")).toEqual(["a", "b"]);
    expect(groupsFrom(["CN=IT-Admins,OU=Groups,DC=uni,DC=example"])).toEqual([
      "CN=IT-Admins,OU=Groups,DC=uni,DC=example",
      "IT-Admins",
    ]);
    expect(groupsFrom(["/IT/Admins"])).toEqual(["/IT/Admins", "Admins"]);
    expect(groupsFrom(undefined)).toEqual([]);
    expect(groupsFrom(42)).toEqual([]);
  });
});

describe("role for a person", () => {
  const rules = [
    { group: "service-desk", role: "VIEWER" as const },
    { group: "it-admins", role: "ADMIN" as const },
    { group: "engineers", role: "MEMBER" as const },
  ];
  it("takes the highest matching role, case-insensitive", () => {
    expect(roleFor(["Service-Desk", "IT-Admins"], rules, null)).toBe("ADMIN");
    expect(roleFor(["engineers"], rules, null)).toBe("MEMBER");
  });
  it("falls back to the default role, or refuses", () => {
    expect(roleFor(["students"], rules, "VIEWER")).toBe("VIEWER");
    expect(roleFor(["students"], rules, null)).toBeNull();
    expect(roleFor([], [], null)).toBeNull();
  });
  it("reads the email domain", () => {
    expect(emailDomain("Alice@Uni.Example")).toBe("uni.example");
    expect(emailDomain("nope")).toBe("");
  });
});
