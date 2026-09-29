// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-error";

describe("authErrorMessage", () => {
  it("uses generic copy for bad credentials (no account enumeration)", () => {
    expect(authErrorMessage({ status: 401, message: "User not found" }, "x")).toBe(
      "Invalid email or password.",
    );
  });

  it("explains unverified email", () => {
    expect(authErrorMessage({ status: 403, message: "Email not verified" }, "x")).toMatch(
      /Verify your email/,
    );
  });

  it("explains rate limiting", () => {
    expect(authErrorMessage({ status: 429 }, "x")).toMatch(/Too many attempts/);
  });

  it("falls back when there is no message", () => {
    expect(authErrorMessage({ status: 500 }, "Could not sign in.")).toBe("Could not sign in.");
    expect(authErrorMessage(null, "fallback")).toBe("fallback");
  });
});
