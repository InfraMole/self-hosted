// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { agentHostMetadata, extractIpAddresses, mergeHostMetadata } from "./host";
import { sampleReport } from "./fixtures";
import { agentConfig, reportSchemaV1 } from "./protocol";
import { bearerAgentSecret, generateSecret, hashSecret, isWellFormed } from "./secrets";

describe("secrets", () => {
  it("generates typed, well-formed, unique secrets and stores only a hash", () => {
    const a = generateSecret("agent");
    const b = generateSecret("agent");
    expect(a.value).toMatch(/^dmp_agt_[A-Za-z0-9_-]{43}$/);
    expect(a.value).not.toBe(b.value);
    expect(a.hash).toBe(hashSecret(a.value));
    expect(a.hash).not.toContain(a.value.slice(8));
    expect(a.displayPrefix).toBe(a.value.slice(0, 12));
    expect(isWellFormed(a.value, "agent")).toBe(true);
    expect(isWellFormed(a.value, "enrollment")).toBe(false);
    expect(isWellFormed(generateSecret("enrollment").value, "enrollment")).toBe(true);
  });

  it("parses bearer headers strictly", () => {
    const { value } = generateSecret("agent");
    expect(bearerAgentSecret(`Bearer ${value}`)).toBe(value);
    expect(bearerAgentSecret(`bearer ${value}`)).toBe(value);
    expect(bearerAgentSecret(value)).toBeNull();
    expect(bearerAgentSecret(`Bearer ${generateSecret("enrollment").value}`)).toBeNull();
    expect(bearerAgentSecret("Bearer dmp_agt_short")).toBeNull();
    expect(bearerAgentSecret(null)).toBeNull();
  });
});

describe("reportSchemaV1", () => {
  it("accepts a valid report", () => {
    expect(reportSchemaV1.safeParse(sampleReport()).success).toBe(true);
  });

  it("rejects fields outside the contract (data minimisation)", () => {
    const withCmdline = sampleReport();
    (withCmdline.connections[0]!.process as Record<string, unknown>).cmdline =
      "app.exe --password=x";
    expect(reportSchemaV1.safeParse(withCmdline).success).toBe(false);

    const withEnv = { ...sampleReport(), environment: { PATH: "x" } };
    expect(reportSchemaV1.safeParse(withEnv).success).toBe(false);
  });

  it("enforces array limits and versions", () => {
    const tooMany = sampleReport({
      services: Array.from({ length: 1001 }, (_, i) => ({ name: `s${i}`, state: "running" })),
    });
    expect(reportSchemaV1.safeParse(tooMany).success).toBe(false);
    expect(reportSchemaV1.safeParse({ ...sampleReport(), schemaVersion: 2 }).success).toBe(false);
  });
});

describe("agentConfig", () => {
  it("clamps the report interval", () => {
    expect(agentConfig(5)).toEqual({ reportIntervalSec: 60, sampleIntervalSec: 30 });
    expect(agentConfig(300).reportIntervalSec).toBe(300);
    expect(agentConfig(99999).reportIntervalSec).toBe(3600);
  });
});

describe("host metadata", () => {
  it("keeps routable addresses only", () => {
    expect(extractIpAddresses(sampleReport().interfaces)).toEqual(["10.0.0.23"]);
    expect(
      extractIpAddresses([
        { name: "x", addresses: ["169.254.1.1/16", "2001:db8::5/64", "garbage"] },
      ]),
    ).toEqual(["2001:db8::5"]);
  });

  it("builds metadata from the report", () => {
    expect(agentHostMetadata(sampleReport())).toEqual({
      hostname: "APP01",
      fqdn: "app01.corp.local",
      os: "Microsoft Windows Server 2022 Standard 10.0.20348",
      ipAddresses: ["10.0.0.23"],
    });
  });

  it("agent-owned keys overwrite, human keys are preserved", () => {
    expect(
      mergeHostMetadata(
        { hostname: "old", version: "3.1", ipAddresses: ["10.0.0.1"], fqdn: "old.fqdn" },
        { hostname: "new", os: "Linux" },
      ),
    ).toEqual({ hostname: "new", os: "Linux", version: "3.1" });
  });
});
