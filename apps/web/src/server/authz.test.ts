// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  ROLES,
  assertRole,
  hasRole,
  type Role,
  type WorkspaceContext,
} from "./authz";

const ctx = (role: Role): WorkspaceContext => ({
  workspaceId: "ws_1",
  workspaceSlug: "acme",
  workspaceName: "Acme",
  userId: "u_1",
  role,
});

describe("hasRole", () => {
  it("orders roles VIEWER < MEMBER < ADMIN < OWNER", () => {
    expect(ROLES).toEqual(["VIEWER", "MEMBER", "ADMIN", "OWNER"]);
    for (const [i, role] of ROLES.entries()) {
      for (const [j, minimum] of ROLES.entries()) {
        expect(hasRole(role, minimum)).toBe(i >= j);
      }
    }
  });
});

describe("assertRole", () => {
  it("throws ForbiddenError below the minimum", () => {
    expect(() => assertRole(ctx("VIEWER"), "MEMBER")).toThrow(ForbiddenError);
    expect(() => assertRole(ctx("MEMBER"), "ADMIN")).toThrow(ForbiddenError);
    expect(() => assertRole(ctx("ADMIN"), "OWNER")).toThrow(ForbiddenError);
  });

  it("passes at or above the minimum", () => {
    expect(() => assertRole(ctx("MEMBER"), "MEMBER")).not.toThrow();
    expect(() => assertRole(ctx("OWNER"), "VIEWER")).not.toThrow();
  });
});
