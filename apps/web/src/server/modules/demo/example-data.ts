// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Example infrastructure shared by the development seed (prisma/seed.ts) and
 * the public demo (DEMO_MODE, ./demo.ts). Deliberately NOT "server-only": the
 * seed runs outside Next.js. Writes go through whatever Prisma client the
 * caller passes (owner connection for the seed, tenantDb for the demo).
 */
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RelationshipType } from "@/generated/prisma/enums";

export type Seed = Omit<Prisma.ResourceCreateManyInput, "workspaceId">;

// Mirrors the example infrastructure in docs/PRODUCT.md.
export const RESOURCES: Seed[] = [
  {
    name: "Cloudflare",
    type: "EXTERNAL_SERVICE",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "DNS + proxy in front of public sites",
    tags: ["edge", "dns"],
    links: [{ label: "Dashboard", url: "https://dash.cloudflare.com" }],
  },
  {
    name: "APP01",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Main Windows web server",
    tags: ["iis", "windows"],
    metadata: {
      hostname: "app01",
      fqdn: "app01.corp.local",
      os: "Windows Server 2022",
      ipAddresses: ["10.0.0.23"],
    },
  },
  {
    name: "APP02",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "MEDIUM",
    tags: ["linux"],
    metadata: { hostname: "app02", os: "Ubuntu 24.04", ipAddresses: ["10.0.0.24"] },
  },
  {
    name: "IIS",
    type: "WINDOWS_SERVICE",
    environment: "PRODUCTION",
    description: "W3SVC on APP01",
    tags: ["iis"],
  },
  {
    name: "IT Portal",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "MEDIUM",
    description: "Internal tool for IT requests",
    tags: ["internal"],
  },
  {
    name: "Billing",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Invoicing and payments service",
    notes: "Owned by the finance systems team.\nAvoid restarts during month-end closing.",
  },
  {
    name: "CustomerAPI",
    type: "API",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Public API used by Web and Mobile",
    tags: ["public"],
    metadata: { version: "3.4.1" },
  },
  {
    name: "Web",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Customer website",
    tags: ["public"],
  },
  {
    name: "Mobile",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "iOS / Android app backend consumer",
    tags: ["public"],
  },
  {
    name: "SQL01",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "SQL Server host",
    tags: ["mssql", "windows"],
    metadata: {
      hostname: "sql01",
      fqdn: "sql01.corp.local",
      os: "Windows Server 2019",
      ipAddresses: ["10.0.0.40"],
    },
  },
  {
    name: "CustomersDB",
    type: "DATABASE",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "MSSQL database on SQL01",
    tags: ["mssql"],
    metadata: { version: "SQL Server 2019" },
  },
  {
    name: "DC01",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Domain controller",
    tags: ["ad", "windows"],
    metadata: { hostname: "dc01", os: "Windows Server 2022", ipAddresses: ["10.0.0.10"] },
  },
  {
    name: "corp.local",
    type: "DOMAIN",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Active Directory domain",
    tags: ["ad"],
  },
  {
    name: "NAS01",
    type: "STORAGE",
    environment: "PRODUCTION",
    criticality: "MEDIUM",
    description: "Backup target (SMB)",
    tags: ["backup"],
    metadata: { hostname: "nas01", ipAddresses: ["10.0.0.60"] },
  },
  {
    name: "PVE01",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Proxmox hypervisor",
    tags: ["proxmox"],
    metadata: { hostname: "pve01", os: "Proxmox VE 8", ipAddresses: ["10.0.0.5"] },
  },
  {
    name: "redis-cache",
    type: "CONTAINER",
    environment: "PRODUCTION",
    criticality: "MEDIUM",
    tags: ["docker", "cache"],
    metadata: { version: "7.4" },
  },
  {
    name: "Zabbix",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "LOW",
    description: "Monitoring (not our job — we only map it)",
    tags: ["monitoring"],
  },
  {
    name: "APP-STG01",
    type: "VM",
    environment: "STAGING",
    criticality: "LOW",
    tags: ["staging"],
    metadata: { hostname: "app-stg01", os: "Windows Server 2022", ipAddresses: ["10.10.0.23"] },
  },
  {
    name: "LegacyWorker",
    type: "LINUX_SERVICE",
    environment: "PRODUCTION",
    status: "ARCHIVED",
    description: "Replaced by the new queue consumer",
  },
];

// "from TYPE to" (Impact example: SQL01 -> CustomersDB -> Billing -> IT Portal; CustomerAPI -> Web/Mobile).
export const RELATIONSHIPS: [string, RelationshipType, string, string?][] = [
  ["IIS", "RUNS_ON", "APP01"],
  ["IT Portal", "RUNS_ON", "IIS"],
  ["IT Portal", "CALLS", "Billing", "Shows invoice status to staff"],
  ["IT Portal", "AUTHENTICATES_WITH", "corp.local"],
  ["IT Portal", "EXPOSED_THROUGH", "Cloudflare"],
  ["Billing", "RUNS_ON", "APP01"],
  ["Billing", "USES_DATABASE", "CustomersDB"],
  ["CustomersDB", "RUNS_ON", "SQL01"],
  ["CustomerAPI", "USES_DATABASE", "CustomersDB"],
  ["CustomerAPI", "RUNS_ON", "APP02"],
  ["CustomerAPI", "DEPENDS_ON", "redis-cache"],
  ["CustomerAPI", "EXPOSED_THROUGH", "Cloudflare"],
  ["redis-cache", "RUNS_ON", "APP02"],
  ["Web", "CALLS", "CustomerAPI"],
  ["Web", "EXPOSED_THROUGH", "Cloudflare"],
  ["Mobile", "CALLS", "CustomerAPI"],
  ["corp.local", "DEPENDS_ON", "DC01"],
  ["APP01", "AUTHENTICATES_WITH", "corp.local"],
  ["SQL01", "AUTHENTICATES_WITH", "corp.local"],
  ["PVE01", "HOSTS", "APP02"],
  ["PVE01", "HOSTS", "APP-STG01"],
  ["SQL01", "BACKS_UP_TO", "NAS01"],
  ["APP01", "MONITORED_BY", "Zabbix"],
  ["SQL01", "MONITORED_BY", "Zabbix"],
];

// [from, to, port, protocol guess, process, samples] — detected, awaiting review.
export const DETECTED: [string, string, number, string, string, number][] = [
  ["APP01", "SQL01", 1433, "MSSQL", "w3wp.exe", 128],
  ["APP02", "DC01", 389, "LDAP", "java", 42],
  ["APP01", "NAS01", 445, "SMB", "System", 12],
];

type DemoDb = Pick<PrismaClient, "resource" | "relationship" | "changeEvent">;

/** Fills an existing, empty workspace with the example infrastructure. */
export async function populateExampleWorkspace(
  db: DemoDb,
  workspaceId: string,
  confirmedById: string | null,
): Promise<{ resources: number; relationships: number; suggestions: number }> {
  const ids = new Map<string, string>();
  for (const seed of RESOURCES) {
    const resource = await db.resource.create({
      data: { ...seed, workspaceId, source: "MANUAL" },
    });
    await db.changeEvent.create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        subjectType: "RESOURCE",
        subjectId: resource.id,
        subjectLabel: resource.name,
        kind: "CREATED",
        summary: `Created ${resource.name} (example data)`,
        resourceIds: [resource.id],
      },
    });
    ids.set(resource.name, resource.id);
  }

  for (const [fromName, type, toName, note] of RELATIONSHIPS) {
    const from = ids.get(fromName);
    const to = ids.get(toName);
    if (!from || !to) throw new Error(`Unknown resource in example data: ${fromName} / ${toName}`);
    const rel = await db.relationship.create({
      data: {
        workspaceId,
        fromResourceId: from,
        toResourceId: to,
        type,
        note,
        origin: "MANUAL",
        status: "CONFIRMED",
        confirmedById,
        confirmedAt: new Date(),
      },
    });
    await db.changeEvent.create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        subjectType: "RELATIONSHIP",
        subjectId: rel.id,
        subjectLabel: `${fromName} → ${toName}`,
        kind: "CREATED",
        summary: `Added relationship: ${fromName} ${RELATIONSHIP_TYPE_INFO[type].label} ${toName} (example data)`,
        resourceIds: [from, to],
      },
    });
  }

  // Detected (unconfirmed) suggestions with evidence, as an agent would produce (M6).
  const now = Date.now();
  for (const [fromName, toName, port, guess, proc, samples] of DETECTED) {
    const from = ids.get(fromName)!;
    const to = ids.get(toName)!;
    const rel = await db.relationship.create({
      data: {
        workspaceId,
        fromResourceId: from,
        toResourceId: to,
        type: "CONNECTS_TO",
        origin: "DETECTED",
        status: "UNCONFIRMED",
        firstObservedAt: new Date(now - 3 * 86_400_000),
        lastObservedAt: new Date(now - 120_000),
        evidence: {
          create: {
            workspaceId,
            port,
            protocolGuess: guess,
            processName: proc,
            sampleCount: samples,
            firstSeenAt: new Date(now - 3 * 86_400_000),
            lastSeenAt: new Date(now - 120_000),
          },
        },
      },
    });
    await db.changeEvent.create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        subjectType: "RELATIONSHIP",
        subjectId: rel.id,
        subjectLabel: `${fromName} → ${toName}`,
        kind: "DISCOVERED",
        summary: `Detected connection: ${fromName} → ${toName}:${port} (likely ${guess})`,
        resourceIds: [from, to],
      },
    });
  }
  return {
    resources: RESOURCES.length,
    relationships: RELATIONSHIPS.length,
    suggestions: DETECTED.length,
  };
}
