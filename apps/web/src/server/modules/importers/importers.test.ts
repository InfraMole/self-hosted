// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { detectFormat, parseCsv, parseImport, relationshipTypeFrom } from "./parse";
import { planImport, type ExistingResource } from "./plan";

const CSV = `name,type,env,criticality,ips,hostname,os,tags,description,id
APP01,server,prod,high,10.0.0.23,app01,Windows Server 2022,"iis;web","Main ""web"" server",app01
SQL01,Server,Production,Critical,10.0.0.40,,,,,
"Payments, API",external service,,,,,,,Stripe,
`;

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines in fields", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectFormat", () => {
  it("detects json, compose and csv", () => {
    expect(detectFormat(' {"resources":[]}')).toBe("json");
    expect(detectFormat("version: '3'\nservices:\n  web: {}")).toBe("docker-compose");
    expect(detectFormat("name,type\nA,server")).toBe("csv");
  });
});

describe("resources CSV", () => {
  it("normalises aliases and validates rows", () => {
    const batch = parseImport(CSV, "csv");
    expect(batch.errors).toEqual([]);
    expect(
      batch.resources.map((r) => [r.key, r.input.name, r.input.type, r.input.environment]),
    ).toEqual([
      ["app01", "APP01", "SERVER", "PRODUCTION"],
      ["sql01", "SQL01", "SERVER", "PRODUCTION"],
      ["payments, api", "Payments, API", "EXTERNAL_SERVICE", null],
    ]);
    expect(batch.resources[0]!.input).toMatchObject({
      criticality: "HIGH",
      tags: ["iis", "web"],
      description: 'Main "web" server',
      metadata: { hostname: "app01", os: "Windows Server 2022", ipAddresses: ["10.0.0.23"] },
    });
    expect(batch.resources[1]!.provided.sort()).toEqual(
      ["criticality", "environment", "ipAddresses", "type"].sort(),
    );
  });

  it("reports row errors with line numbers", () => {
    const batch = parseImport(
      "name,type,ips\nA,mainframe,\n,server,\nB,server,999.1.1.1\nA,server,",
      "csv",
    );
    expect(batch.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(batch.errors[0]!.message).toMatch(/type/);
    expect(batch.errors[1]!.message).toBe("Missing name.");
    expect(batch.resources.map((r) => r.input.name)).toEqual(["A"]);
  });

  it("flags duplicate keys", () => {
    const batch = parseImport("name,type\nWeb,app\nweb,app", "csv");
    expect(batch.errors).toEqual([{ row: 3, message: 'Duplicate of row 2 ("web").' }]);
  });
});

describe("relationships", () => {
  it("accepts enum names and labels", () => {
    expect(relationshipTypeFrom("uses database")).toBe("USES_DATABASE");
    expect(relationshipTypeFrom("runs-on")).toBe("RUNS_ON");
    expect(relationshipTypeFrom("loves")).toBeNull();
  });

  it("parses a relationships CSV", () => {
    const batch = parseImport(
      "from,type,to,note\nAPP01,uses database,SQL01,orders\nX,loves,Y,",
      "csv",
    );
    expect(batch.relationships).toEqual([
      { row: 2, from: "APP01", to: "SQL01", type: "USES_DATABASE", note: "orders" },
    ]);
    expect(batch.errors[0]).toMatchObject({ row: 3 });
  });
});

describe("JSON", () => {
  it("parses resources and relationships", () => {
    const batch = parseImport(
      JSON.stringify({
        resources: [
          { id: "api", name: "CustomerAPI", type: "API", ipAddresses: ["10.0.0.9"] },
          { name: "DB", type: "database" },
        ],
        relationships: [{ from: "api", type: "USES_DATABASE", to: "DB" }],
      }),
      "json",
    );
    expect(batch.errors).toEqual([]);
    expect(batch.resources.map((r) => r.key)).toEqual(["api", "db"]);
    expect(batch.relationships).toHaveLength(1);
    expect(parseImport("{nope", "json").errors[0]!.message).toMatch(/Invalid JSON/);
  });
});

describe("Docker Compose", () => {
  const compose = `
name: shop
services:
  web:
    image: nginx:1.27
    ports: ["8080:80"]
    depends_on: [api]
  api:
    build: .
    depends_on:
      db:
        condition: service_healthy
      ghost: {}
  db:
    image: postgres:17
`;
  it("maps services to containers and depends_on to relationships", () => {
    const batch = parseImport(compose, "docker-compose");
    expect(batch.errors).toEqual([]);
    expect(batch.resources.map((r) => [r.key, r.input.name, r.input.type])).toEqual([
      ["shop/web", "web", "CONTAINER"],
      ["shop/api", "api", "CONTAINER"],
      ["shop/db", "db", "CONTAINER"],
    ]);
    expect(batch.resources[0]!.input).toMatchObject({
      description: "image nginx:1.27 · ports 8080:80",
      tags: ["compose", "shop"],
      metadata: { version: "1.27" },
    });
    expect(batch.relationships.map((r) => `${r.from}->${r.to}`)).toEqual([
      "shop/web->shop/api",
      "shop/api->shop/db",
    ]);
    expect(batch.warnings).toEqual(['api: depends on unknown service "ghost".']);
    expect(parseImport("services: [", "docker-compose").errors[0]!.message).toMatch(/Invalid YAML/);
  });
});

describe("planImport", () => {
  const existing: ExistingResource[] = [
    {
      id: "r-app01",
      name: "APP01",
      type: "SERVER",
      source: "MANUAL",
      externalId: null,
      environment: "PRODUCTION",
      criticality: "HIGH",
      description: 'Main "web" server',
      notes: "keep me",
      tags: ["web", "iis"],
      metadata: { hostname: "app01", os: "Windows Server 2022", ipAddresses: ["10.0.0.23"] },
    },
    {
      id: "r-sql",
      name: "SQL01",
      type: "SERVER",
      source: "IMPORT",
      externalId: "csv:sql01",
      environment: null,
      criticality: null,
      description: null,
      notes: null,
      tags: [],
      metadata: {},
    },
  ];

  it("creates, updates and leaves unchanged; matches by externalId then name + type", () => {
    const plan = planImport(parseImport(CSV, "csv"), existing, []);
    expect(plan.resources.map((r) => [r.name, r.action, r.matchedBy, r.changes])).toEqual([
      ["APP01", "unchanged", "name", []],
      ["SQL01", "update", "externalId", ["criticality", "environment", "ipAddresses"]],
      ["Payments, API", "create", null, []],
    ]);
    expect(plan.counts).toEqual({ create: 1, update: 1, unchanged: 1, relationships: 0 });
  });

  it("resolves relationship endpoints to the batch or the library, and detects existing ones", () => {
    const batch = parseImport(
      JSON.stringify({
        resources: [{ id: "new", name: "NewApp", type: "application" }],
        relationships: [
          { from: "new", type: "USES_DATABASE", to: "SQL01" },
          { from: "APP01", type: "DEPENDS_ON", to: "sql01" },
          { from: "APP01", type: "CALLS", to: "Nowhere" },
        ],
      }),
      "json",
    );
    const plan = planImport(batch, existing, [
      { from: "r-app01", to: "r-sql", type: "DEPENDS_ON" },
    ]);
    expect(plan.relationships.map((r) => [r.fromLabel, r.toLabel, r.action, r.from, r.to])).toEqual(
      [
        ["NewApp", "SQL01", "create", { externalId: "json:new" }, { id: "r-sql" }],
        ["APP01", "SQL01", "exists", { id: "r-app01" }, { id: "r-sql" }],
      ],
    );
    expect(plan.errors).toEqual([{ row: 3, message: 'Unknown resource "Nowhere".' }]);
  });
});
