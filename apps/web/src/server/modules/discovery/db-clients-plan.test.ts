// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { databaseKey, planDatabaseClients, type DatabaseClientInput } from "./db-clients-plan";
import { buildIpIndex } from "./plan";

const index = buildIpIndex([
  { id: "sql01", ipAddresses: ["10.0.0.40"] },
  { id: "app01", ipAddresses: ["10.0.0.23"] },
  { id: "app02", ipAddresses: ["10.0.0.24"] },
  { id: "vip-a", ipAddresses: ["10.0.0.99"] },
  { id: "vip-b", ipAddresses: ["10.0.0.99"] },
]);
const databases = new Map([
  [databaseKey("sql01", "mssql", "MSSQLSERVER", "Billing"), "billing-db"],
  [databaseKey("sql01", "mssql", "REPORTING", "Sales"), "sales-db"],
]);
const client = (over: Partial<DatabaseClientInput>): DatabaseClientInput => ({
  engine: "mssql",
  instance: "MSSQLSERVER",
  database: "Billing",
  address: "10.0.0.23",
  port: 1433,
  sessions: 2,
  ...over,
});

describe("planDatabaseClients (M42)", () => {
  it("suggests client → database, adding up sessions per pair", () => {
    const plan = planDatabaseClients(
      "sql01",
      [
        client({}),
        client({ port: 1434, sessions: 1 }),
        client({ instance: "reporting", database: "SALES", address: "10.0.0.24" }),
      ],
      databases,
      index,
      [],
    );
    expect(plan.create).toEqual([
      { from: "app01", to: "billing-db", port: 1433, sessions: 3 },
      { from: "app02", to: "sales-db", port: 1433, sessions: 2 },
    ]);
    expect(plan.refresh).toEqual([]);
  });

  it("skips unknown databases, unresolved or ambiguous clients and the host itself", () => {
    const plan = planDatabaseClients(
      "sql01",
      [
        client({ database: "NotImported" }),
        client({ address: "10.9.9.9" }),
        client({ address: "10.0.0.99" }),
        client({ address: "10.0.0.40" }),
      ],
      databases,
      index,
      [],
    );
    expect(plan).toEqual({ create: [], refresh: [] });
  });

  it("reuses an existing relationship and never touches an ignored or reversed one", () => {
    const plan = planDatabaseClients(
      "sql01",
      [
        client({}),
        client({ address: "10.0.0.24" }),
        client({ address: "10.0.0.24", database: "Sales", instance: "REPORTING" }),
      ],
      databases,
      index,
      [
        { id: "r-ignored", from: "app01", to: "billing-db", status: "IGNORED" },
        { id: "r-confirmed", from: "app01", to: "billing-db", status: "CONFIRMED" },
        { id: "r-gone", from: "app02", to: "billing-db", status: "IGNORED" },
        { id: "r-reverse", from: "sales-db", to: "app02", status: "CONFIRMED" },
      ],
    );
    expect(plan.refresh).toEqual([{ relationshipId: "r-confirmed", port: 1433, sessions: 2 }]);
    expect(plan.create).toEqual([]);
  });

  it("honours exclusion rules on the port, the client, the database and its host", () => {
    const run = (rule: { port?: number; resourceId?: string }) =>
      planDatabaseClients(
        "sql01",
        [client({})],
        databases,
        index,
        [],
        [
          {
            id: "x",
            port: rule.port ?? null,
            processName: null,
            resourceId: rule.resourceId ?? null,
          },
        ],
      ).create.length;
    expect(run({ port: 1433 })).toBe(0);
    expect(run({ resourceId: "app01" })).toBe(0);
    expect(run({ resourceId: "billing-db" })).toBe(0);
    expect(run({ resourceId: "sql01" })).toBe(0);
    expect(run({ port: 5432 })).toBe(1);
  });
});
