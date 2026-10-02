// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a valid configuration", () => {
    expect(parseEnv(valid)).toMatchObject({ NODE_ENV: "development" });
  });

  it("local-source networks: validated, and never on the hosted service (M27)", () => {
    expect(parseEnv({ ...valid, INTEGRATIONS_PRIVATE_NETWORKS: "192.168.1.0/24" })).toMatchObject({
      INTEGRATIONS_PRIVATE_NETWORKS: "192.168.1.0/24",
    });
    expect(() => parseEnv({ ...valid, INTEGRATIONS_PRIVATE_NETWORKS: "lan" })).toThrow(
      /INTEGRATIONS_PRIVATE_NETWORKS/,
    );
    expect(() =>
      parseEnv({ ...valid, EDITION: "cloud", INTEGRATIONS_PRIVATE_NETWORKS: "10.0.0.0/8" }),
    ).toThrow(/not allowed on EDITION=cloud/);
  });

  it("rejects a short auth secret", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://u:p@h/db" })).toThrow(/DATABASE_URL/);
  });

  it("requires https in production (except localhost)", () => {
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "http://app.example.com" }),
    ).toThrow(/https/);
    expect(parseEnv({ ...valid, NODE_ENV: "production" })).toMatchObject({
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    expect(
      parseEnv({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "https://app.example.com" }),
    ).toMatchObject({ NODE_ENV: "production" });
  });

  it("does not echo secret values in errors", () => {
    try {
      parseEnv({ ...valid, BETTER_AUTH_SECRET: "leaky" });
    } catch (error) {
      expect(String(error)).not.toContain("leaky");
    }
  });
});
