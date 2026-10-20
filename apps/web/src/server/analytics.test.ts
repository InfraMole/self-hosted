// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { analyticsConfig, contentSecurityPolicy } from "./analytics";
import { parseEnv } from "./env";

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("analytics settings", () => {
  it("are off unless both the script URL and the website ID are set", () => {
    expect(analyticsConfig(parseEnv(BASE))).toBeNull();
    expect(
      analyticsConfig(
        parseEnv({ ...BASE, UMAMI_SCRIPT_URL: "https://analytics.inframole.com/script.js" }),
      ),
    ).toBeNull();
    expect(
      analyticsConfig(
        parseEnv({
          ...BASE,
          UMAMI_SCRIPT_URL: "https://analytics.inframole.com/script.js",
          UMAMI_WEBSITE_ID: "93b253c9-1775-473d-b053-b4e0e3a7fc9b",
          UMAMI_DOMAINS: "inframole.com",
        }),
      ),
    ).toEqual({
      scriptUrl: "https://analytics.inframole.com/script.js",
      websiteId: "93b253c9-1775-473d-b053-b4e0e3a7fc9b",
      domains: "inframole.com",
    });
  });

  it("refuse an http script URL or a malformed ID", () => {
    expect(() =>
      parseEnv({ ...BASE, UMAMI_SCRIPT_URL: "http://analytics.example.com/s.js" }),
    ).toThrow(/UMAMI_SCRIPT_URL/);
    expect(() => parseEnv({ ...BASE, UMAMI_WEBSITE_ID: "not-a-uuid" })).toThrow(/UMAMI_WEBSITE_ID/);
  });
});

describe("content security policy", () => {
  it("allows the analytics origin only when configured", () => {
    const off = contentSecurityPolicy({ dev: false });
    expect(off).toContain("script-src 'self' 'unsafe-inline';");
    expect(off).toContain("connect-src 'self';");
    expect(off).not.toContain("analytics");
    const on = contentSecurityPolicy({
      dev: false,
      analyticsOrigin: "https://analytics.inframole.com",
    });
    expect(on).toContain("script-src 'self' 'unsafe-inline' https://analytics.inframole.com;");
    expect(on).toContain("connect-src 'self' https://analytics.inframole.com;");
    expect(on).toContain("frame-ancestors 'none'");
  });
});
