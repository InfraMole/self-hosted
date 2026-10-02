// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  fieldErrors,
  formatLinks,
  parseLinks,
  resourceFiltersSchema,
  resourceFormToInput,
  resourceInputSchema,
} from "./schemas";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("resourceInputSchema", () => {
  it("applies defaults for a minimal resource", () => {
    expect(resourceInputSchema.parse({ name: " APP01 ", type: "SERVER" })).toEqual({
      name: "APP01",
      type: "SERVER",
      environment: null,
      criticality: null,
      status: "ACTIVE",
      description: null,
      notes: null,
      owner: null,
      ownerContact: null,
      tags: [],
      links: [],
      metadata: {},
    });
  });

  it("normalises and deduplicates tags", () => {
    const r = resourceInputSchema.parse({ name: "x", type: "VM", tags: ["Web", "web", "iis"] });
    expect(r.tags).toEqual(["web", "iis"]);
  });

  it.each([
    [{ type: "SERVER" }, "name"],
    [{ name: "x", type: "MAINFRAME" }, "type"],
    [{ name: "x", type: "SERVER", status: "DISCOVERED" }, "status"],
    [{ name: "x", type: "SERVER", tags: ["has space"] }, "tags"],
    [
      { name: "x", type: "SERVER", links: [{ label: "a", url: "http://insecure.example" }] },
      "links",
    ],
    [{ name: "x", type: "SERVER", links: [{ label: "a", url: "javascript:alert(1)" }] }, "links"],
    [{ name: "x", type: "SERVER", metadata: { ipAddresses: ["10.0.0.300"] } }, "metadata"],
    [{ name: "x", type: "SERVER", metadata: { password: "hunter2" } }, "metadata"],
    [{ name: "x".repeat(129), type: "SERVER" }, "name"],
  ])("rejects %j (field %s)", (input, field) => {
    const result = resourceInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path[0]).toBe(field);
  });

  it("accepts IPv4 and IPv6 addresses", () => {
    const r = resourceInputSchema.parse({
      name: "x",
      type: "SERVER",
      metadata: { ipAddresses: ["10.0.0.23", "fe80::1"] },
    });
    expect(r.metadata.ipAddresses).toEqual(["10.0.0.23", "fe80::1"]);
  });
});

describe("resourceFormToInput", () => {
  it("maps form fields, empty strings to null and lists to arrays", () => {
    const input = resourceFormToInput(
      form({
        name: "SQL01",
        type: "DATABASE",
        environment: "PRODUCTION",
        criticality: "",
        description: "  ",
        tags: "sql, prod  mssql",
        ipAddresses: "10.0.0.40,\n10.0.1.40",
        hostname: "sql01",
        links: "Runbook https://wiki.example.com/sql01\nhttps://grafana.example.com/d/1",
      }),
    );
    expect(resourceInputSchema.parse(input)).toMatchObject({
      name: "SQL01",
      type: "DATABASE",
      environment: "PRODUCTION",
      criticality: null,
      description: null,
      tags: ["sql", "prod", "mssql"],
      metadata: { hostname: "sql01", ipAddresses: ["10.0.0.40", "10.0.1.40"] },
      links: [
        { label: "Runbook", url: "https://wiki.example.com/sql01" },
        { label: "grafana.example.com", url: "https://grafana.example.com/d/1" },
      ],
    });
  });
});

describe("links round-trip", () => {
  it("formatLinks is parsed back by parseLinks", () => {
    const links = [{ label: "Admin portal", url: "https://portal.example.com" }];
    expect(parseLinks(formatLinks(links))).toEqual(links);
  });
});

describe("fieldErrors", () => {
  it("maps metadata issues to their input names", () => {
    const result = resourceInputSchema.safeParse({
      name: "",
      type: "SERVER",
      metadata: { ipAddresses: ["nope"] },
    });
    const errors = fieldErrors(result.error!);
    expect(Object.keys(errors).sort()).toEqual(["ipAddresses", "name"]);
  });
});

describe("resourceFiltersSchema", () => {
  it("drops invalid values instead of failing", () => {
    expect(
      resourceFiltersSchema.parse({ type: "NOPE", environment: "PRODUCTION", q: "app" }),
    ).toEqual({
      type: undefined,
      environment: "PRODUCTION",
      status: undefined,
      q: "app",
    });
  });
});
