// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseImport } from "./parse";
import { planImport } from "./plan";

// Trimmed real-world shapes of each CLI's JSON output.
const PROXMOX = JSON.stringify([
  { id: "node/pve01", type: "node", node: "pve01", status: "online", maxmem: 68719476736 },
  {
    id: "qemu/100",
    type: "qemu",
    node: "pve01",
    name: "APP-STG01",
    vmid: 100,
    status: "running",
    maxmem: 8589934592,
  },
  {
    id: "lxc/101",
    type: "lxc",
    node: "pve02",
    name: "redis-cache",
    vmid: 101,
    status: "running",
    maxmem: 1073741824,
  },
  {
    id: "qemu/9000",
    type: "qemu",
    node: "pve01",
    name: "ubuntu-template",
    vmid: 9000,
    template: 1,
  },
  { id: "storage/pve01/local", type: "storage", node: "pve01", storage: "local" },
]);

const AZURE = JSON.stringify([
  {
    id: "/subscriptions/x/resourceGroups/RG-WEB/providers/Microsoft.Compute/virtualMachines/web-vm-01",
    name: "web-vm-01",
    resourceGroup: "RG-WEB",
    location: "westeurope",
    privateIps: "10.1.0.4",
    publicIps: "20.50.1.2",
    powerState: "VM running",
    hardwareProfile: { vmSize: "Standard_B2s" },
    storageProfile: {
      osDisk: { osType: "Linux" },
      imageReference: { offer: "0001-com-ubuntu-server-jammy", sku: "22_04-lts" },
    },
    tags: { environment: "prod", owner: "Platform Team" },
  },
]);

const AWS = JSON.stringify({
  Reservations: [
    {
      Instances: [
        {
          InstanceId: "i-0abc123",
          InstanceType: "t3.medium",
          PrivateIpAddress: "172.31.5.10",
          PublicIpAddress: "3.120.1.1",
          PrivateDnsName: "ip-172-31-5-10.eu-central-1.compute.internal",
          PlatformDetails: "Linux/UNIX",
          State: { Name: "running" },
          Placement: { AvailabilityZone: "eu-central-1a" },
          Tags: [
            { Key: "Name", Value: "api-prod-1" },
            { Key: "Environment", Value: "production" },
          ],
        },
        { InstanceId: "i-dead", State: { Name: "terminated" } },
      ],
    },
  ],
});

describe("Proxmox export", () => {
  it("maps nodes, VMs and containers with confirmed HOSTS placement", () => {
    const batch = parseImport(PROXMOX, "json");
    expect(batch.format).toBe("proxmox");
    expect(batch.errors).toEqual([]);
    expect(batch.resources.map((r) => [r.key, r.input.name, r.input.type])).toEqual([
      ["node/pve01", "pve01", "SERVER"],
      ["node/pve02", "pve02", "SERVER"], // referenced by a guest only
      ["qemu/100", "APP-STG01", "VM"],
      ["lxc/101", "redis-cache", "CONTAINER"],
    ]);
    expect(batch.resources[2]!.input.description).toBe("VM 100 · running · 8 GB RAM");
    expect(batch.relationships).toEqual([
      expect.objectContaining({
        from: "node/pve01",
        to: "qemu/100",
        type: "HOSTS",
        suggested: false,
      }),
      expect.objectContaining({
        from: "node/pve02",
        to: "lxc/101",
        type: "HOSTS",
        suggested: false,
      }),
    ]);
    expect(batch.warnings).toEqual(["Skipped template ubuntu-template."]);
  });
});

describe("Azure export", () => {
  it("maps VMs with IPs, OS and tags (environment from tags)", () => {
    const batch = parseImport(AZURE, "json");
    expect(batch.format).toBe("azure");
    const vm = batch.resources[0]!;
    expect(vm.key).toMatch(/virtualmachines\/web-vm-01$/);
    expect(vm.input).toMatchObject({
      name: "web-vm-01",
      type: "VM",
      environment: "PRODUCTION",
      description: "Standard_B2s · westeurope · rg RG-WEB · VM running",
      tags: ["azure", "environment:prod", "owner:platform-team"],
      metadata: {
        os: "Linux 0001-com-ubuntu-server-jammy 22_04-lts",
        ipAddresses: ["10.1.0.4", "20.50.1.2"],
      },
    });
  });
});

describe("AWS export", () => {
  it("maps EC2 instances (Name tag, IPs) and skips terminated ones", () => {
    const batch = parseImport(AWS, "json");
    expect(batch.format).toBe("aws");
    expect(batch.resources).toHaveLength(1);
    expect(batch.resources[0]!.input).toMatchObject({
      name: "api-prod-1",
      type: "VM",
      environment: "PRODUCTION",
      metadata: {
        hostname: "ip-172-31-5-10.eu-central-1.compute.internal",
        os: "Linux/UNIX",
        ipAddresses: ["172.31.5.10", "3.120.1.1"],
      },
    });
    expect(batch.warnings).toEqual(["Skipped terminated instance i-dead."]);
  });

  it("maps RDS databases", () => {
    const batch = parseImport(
      JSON.stringify({
        DBInstances: [
          {
            DBInstanceIdentifier: "orders-db",
            Engine: "postgres",
            EngineVersion: "16.3",
            DBInstanceClass: "db.t4g.micro",
            Endpoint: { Address: "orders-db.abc.eu-central-1.rds.amazonaws.com", Port: 5432 },
          },
        ],
      }),
      "json",
    );
    expect(batch.resources[0]).toMatchObject({
      key: "rds/orders-db",
      input: {
        type: "DATABASE",
        description: "RDS postgres · db.t4g.micro · port 5432",
        metadata: { hostname: "orders-db.abc.eu-central-1.rds.amazonaws.com", version: "16.3" },
      },
    });
  });

  it("reports an empty export", () => {
    expect(parseImport('{"Reservations": []}', "json").errors[0]!.message).toMatch(/No EC2/);
  });
});

describe("matching platform guests to agent hosts", () => {
  const existing = (name: string, type: "SERVER" | "VM", source: "AGENT" | "MANUAL") => ({
    id: `r-${name}-${source}`,
    name,
    type,
    source,
    externalId: null,
    environment: null,
    criticality: null,
    description: null,
    notes: null,
    tags: [],
    metadata: {},
  });

  it("a Proxmox VM that runs the agent matches the agent's SERVER host and keeps its type", () => {
    const plan = planImport(
      parseImport(PROXMOX, "json"),
      [existing("APP-STG01", "SERVER", "AGENT")],
      [],
    );
    const vm = plan.resources.find((r) => r.name === "APP-STG01")!;
    expect(vm).toMatchObject({ targetId: "r-APP-STG01-AGENT", matchedBy: "name" });
    expect(vm.provided).not.toContain("type");
  });

  it("does not match a manually created SERVER with the same name (different machine possible)", () => {
    const plan = planImport(
      parseImport(PROXMOX, "json"),
      [existing("APP-STG01", "SERVER", "MANUAL")],
      [],
    );
    expect(plan.resources.find((r) => r.name === "APP-STG01")!.action).toBe("create");
  });
});

describe("windows workloads (M16)", () => {
  const host = { id: "host-web01", name: "WEB01" };
  const existing = [
    {
      id: "host-web01",
      name: "WEB01",
      type: "SERVER" as const,
      source: "AGENT" as const,
      externalId: "agent-1",
      environment: null,
      criticality: null,
      description: null,
      notes: null,
      tags: [],
      metadata: {},
    },
  ];

  it("turns IIS sites and user databases into resources that run on the host", () => {
    const batch = parseImport(
      JSON.stringify({
        host,
        iisSites: [
          {
            name: "Portal",
            bindings: [
              { protocol: "https", port: 443, host: "Portal.corp.local" },
              { protocol: "http", port: 80, host: "portal.corp.local" },
            ],
          },
          { name: "Default Web Site", bindings: [{ protocol: "http", port: 8080 }] },
        ],
        sqlDatabases: [
          { instance: "MSSQLSERVER", name: "Customers" },
          { instance: "REPORTING", name: "Sales" },
          { instance: "MSSQLSERVER", name: "master" },
        ],
      }),
      "workloads",
    );
    expect(batch.errors).toEqual([]);
    expect(
      batch.resources.map((r) => [r.input.name, r.input.type, r.input.metadata, r.input.tags]),
    ).toEqual([
      ["Portal (WEB01)", "APPLICATION", { fqdn: "portal.corp.local", ports: [80, 443] }, ["iis"]],
      ["Default Web Site (WEB01)", "APPLICATION", { ports: [8080] }, ["iis"]],
      ["Customers (WEB01)", "DATABASE", {}, ["sql-server"]],
      ["Sales (WEB01\\REPORTING)", "DATABASE", {}, ["sql-server"]],
    ]);
    expect(batch.resources[0]!.input.description).toBe(
      "IIS site on WEB01 · https:443 Portal.corp.local, http:80 portal.corp.local",
    );
    const plan = planImport(batch, existing, []);
    expect(plan.errors).toEqual([]);
    expect(
      plan.relationships.map((r) => [r.fromLabel, r.type, r.toLabel, r.from.externalId]),
    ).toEqual([
      ["Portal (WEB01)", "RUNS_ON", "WEB01", "workloads:host-web01/iis/portal"],
      ["Default Web Site (WEB01)", "RUNS_ON", "WEB01", "workloads:host-web01/iis/default web site"],
      ["Customers (WEB01)", "RUNS_ON", "WEB01", "workloads:host-web01/mssql/mssqlserver/customers"],
      [
        "Sales (WEB01\\REPORTING)",
        "RUNS_ON",
        "WEB01",
        "workloads:host-web01/mssql/reporting/sales",
      ],
    ]);
  });

  it("only resolves id: references to resources of this workspace", () => {
    const batch = parseImport(
      JSON.stringify({
        host: { id: "someone-else", name: "X" },
        iisSites: [{ name: "A", bindings: [] }],
      }),
      "workloads",
    );
    const plan = planImport(batch, existing, []);
    expect(plan.errors.map((e) => e.message)).toEqual(['Unknown resource "id:someone-else".']);
  });
});
