// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Demo data for local development: `pnpm db:seed`.
 * Re-runnable: deletes and recreates the demo user + "demo" workspace only.
 *
 *   Sign in: demo@depmap.local / demo-password
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { RelationshipType } from "../src/generated/prisma/enums";

const DEMO_EMAIL = "demo@depmap.local";
const DEMO_PASSWORD = "demo-password";
const DEMO_SLUG = "demo";

type Seed = Omit<Prisma.ResourceCreateManyInput, "workspaceId">;

// Mirrors the example infrastructure in docs/PRODUCT.md.
const RESOURCES: Seed[] = [
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
    name: "RotationSecret",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Credential rotation service",
    notes: "Owned by the infra team.\nRestarts are safe during business hours.",
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

// "from TYPE to" — mirrors docs/PRODUCT.md (Impact example: SQL01 -> CustomersDB -> RotationSecret -> IT Portal; CustomerAPI -> Web/Mobile).
const RELATIONSHIPS: [string, RelationshipType, string, string?][] = [
  ["IIS", "RUNS_ON", "APP01"],
  ["IT Portal", "RUNS_ON", "IIS"],
  ["IT Portal", "CALLS", "RotationSecret", "Fetches rotated service credentials"],
  ["IT Portal", "AUTHENTICATES_WITH", "corp.local"],
  ["IT Portal", "EXPOSED_THROUGH", "Cloudflare"],
  ["RotationSecret", "RUNS_ON", "APP01"],
  ["RotationSecret", "USES_DATABASE", "CustomersDB"],
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
const DETECTED: [string, string, number, string, string, number][] = [
  ["APP01", "SQL01", 1433, "MSSQL", "w3wp.exe", 128],
  ["APP02", "DC01", 389, "LDAP", "java", 42],
  ["APP01", "NAS01", 445, "SMB", "System", 12],
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  // The seed writes across tables as the owner (RLS does not apply to it).
  const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_ADMIN / DATABASE_URL is not set (apps/web/.env).");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    // Dev-only reset: allow the cascade to remove the demo's append-only audit rows.
    await db.$transaction([
      db.$executeRaw`SELECT set_config('depmap.allow_audit_delete', 'on', true)`,
      db.workspace.deleteMany({ where: { slug: DEMO_SLUG } }),
    ]);
    await db.user.deleteMany({ where: { email: DEMO_EMAIL } });

    const userId = randomUUID();
    await db.user.create({
      data: {
        id: userId,
        name: "Demo Admin",
        email: DEMO_EMAIL,
        emailVerified: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(DEMO_PASSWORD),
          },
        },
      },
    });

    const workspace = await db.workspace.create({
      data: {
        name: "Demo Infra",
        slug: DEMO_SLUG,
        memberships: { create: { userId, role: "OWNER" } },
      },
    });

    const ids = new Map<string, string>();
    for (const seed of RESOURCES) {
      const resource = await db.resource.create({
        data: { ...seed, workspaceId: workspace.id, source: "MANUAL" },
      });
      await db.changeEvent.create({
        data: {
          workspaceId: workspace.id,
          actorType: "SYSTEM",
          subjectType: "RESOURCE",
          subjectId: resource.id,
          subjectLabel: resource.name,
          kind: "CREATED",
          summary: `Created ${resource.name} (demo seed)`,
        },
      });
      ids.set(resource.name, resource.id);
    }

    for (const [fromName, type, toName, note] of RELATIONSHIPS) {
      const from = ids.get(fromName);
      const to = ids.get(toName);
      if (!from || !to) throw new Error(`Unknown resource in seed: ${fromName} / ${toName}`);
      const rel = await db.relationship.create({
        data: {
          workspaceId: workspace.id,
          fromResourceId: from,
          toResourceId: to,
          type,
          note,
          origin: "MANUAL",
          status: "CONFIRMED",
          confirmedById: userId,
          confirmedAt: new Date(),
        },
      });
      await db.changeEvent.create({
        data: {
          workspaceId: workspace.id,
          actorType: "SYSTEM",
          subjectType: "RELATIONSHIP",
          subjectId: rel.id,
          subjectLabel: `${fromName} → ${toName}`,
          kind: "CREATED",
          summary: `Added relationship: ${fromName} ${RELATIONSHIP_TYPE_INFO[type].label} ${toName} (demo seed)`,
          resourceIds: [from, to],
        },
      });
    }

    // Detected (unconfirmed) suggestions with evidence, as an agent would produce (M6).
    const now = Date.now();
    for (const [fromName, toName, port, guess, proc, samples] of DETECTED) {
      const rel = await db.relationship.create({
        data: {
          workspaceId: workspace.id,
          fromResourceId: ids.get(fromName)!,
          toResourceId: ids.get(toName)!,
          type: "CONNECTS_TO",
          origin: "DETECTED",
          status: "UNCONFIRMED",
          firstObservedAt: new Date(now - 3 * 86_400_000),
          lastObservedAt: new Date(now - 120_000),
          evidence: {
            create: {
              workspaceId: workspace.id,
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
          workspaceId: workspace.id,
          actorType: "SYSTEM",
          subjectType: "RELATIONSHIP",
          subjectId: rel.id,
          subjectLabel: `${fromName} → ${toName}`,
          kind: "DISCOVERED",
          summary: `Detected connection: ${fromName} → ${toName}:${port} (likely ${guess}) (demo seed)`,
          resourceIds: [ids.get(fromName)!, ids.get(toName)!],
        },
      });
    }

    console.log(
      `Seeded workspace "${workspace.slug}" with ${RESOURCES.length} resources and ${RELATIONSHIPS.length} relationships (+${DETECTED.length} suggestions).`,
    );
    console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
