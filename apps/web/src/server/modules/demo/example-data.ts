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

// The example infrastructure of docs/PRODUCT.md, extended (M25) so the demo
// shows everything InfraMole can collect: agent workloads (IIS, SQL Server,
// nginx, HAProxy, Docker), Kubernetes, hypervisors and cloud integrations.
// `source` / `sourceLabel` say which collector would have found each one.
const agent = (host: string) =>
  ({ status: "DISCOVERED", source: "AGENT", sourceLabel: `Agent on ${host}` }) as const;
const integration = (label: string) =>
  ({ status: "DISCOVERED", source: "IMPORT", sourceLabel: label }) as const;

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
    owner: "Infrastructure",
    ownerContact: "infra@northwind.example",
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
    owner: "IT service desk",
    ownerContact: "servicedesk@northwind.example",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "MEDIUM",
    description: "Internal tool for IT requests",
    tags: ["internal"],
  },
  {
    name: "Billing",
    owner: "Finance apps",
    ownerContact: "finance-apps@northwind.example",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Invoicing and payments service",
    notes: "Owned by the finance systems team.\nAvoid restarts during month-end closing.",
  },
  {
    name: "CustomerAPI",
    owner: "Platform team",
    ownerContact: "#platform on Slack",
    type: "API",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Public API used by Web and Mobile",
    tags: ["public"],
    metadata: { version: "3.4.1" },
  },
  {
    name: "Web",
    owner: "Web team",
    ownerContact: "web@northwind.example",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Customer website",
    tags: ["public"],
  },
  {
    name: "Mobile",
    owner: "Mobile team",
    ownerContact: "mobile@northwind.example",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "iOS / Android app backend consumer",
    tags: ["public"],
  },
  {
    name: "SQL01",
    owner: "Data team",
    ownerContact: "data@northwind.example",
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
    owner: "Data team",
    ownerContact: "data@northwind.example",
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
  // ── What the agents found inside the servers (M16, M20, M25) ──
  {
    name: "Portal (APP01)",
    type: "APPLICATION",
    environment: "PRODUCTION",
    description: "IIS site on APP01 · https:443 portal.northwind.example",
    tags: ["iis"],
    metadata: { fqdn: "portal.northwind.example", ports: [443] },
    ...agent("APP01"),
  },
  {
    name: "Reporting (SQL01\\REPORTING)",
    type: "DATABASE",
    environment: "PRODUCTION",
    description: "SQL Server database on SQL01, instance REPORTING",
    tags: ["sql-server"],
    ...agent("SQL01"),
  },
  {
    name: "DOCKER01",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Linux Docker host for the web shop",
    metadata: { hostname: "docker01", os: "Ubuntu 24.04 LTS", ipAddresses: ["10.0.0.50"] },
    ...agent("DOCKER01"),
  },
  {
    name: "shop-web (DOCKER01)",
    type: "CONTAINER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Docker container on DOCKER01 · ghcr.io/northwind/shop:2.3.1 · running",
    tags: ["docker", "compose:shop"],
    metadata: { version: "2.3.1" },
    ...agent("DOCKER01"),
  },
  {
    name: "shop-db (DOCKER01)",
    type: "DATABASE",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "PostgreSQL in Docker on DOCKER01 · postgres:16-alpine · running",
    tags: ["docker", "postgresql", "compose:shop"],
    metadata: { version: "16-alpine", ports: [5432] },
    ...agent("DOCKER01"),
  },
  {
    name: "shop-cache (DOCKER01)",
    type: "DATABASE",
    environment: "PRODUCTION",
    description: "Redis in Docker on DOCKER01 · redis:7-alpine · running",
    tags: ["docker", "redis", "compose:shop"],
    metadata: { version: "7-alpine" },
    ...agent("DOCKER01"),
  },
  {
    name: "traefik (DOCKER01)",
    type: "CONTAINER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Traefik in Docker on DOCKER01 · traefik:v3.1 · running",
    tags: ["docker", "traefik"],
    metadata: { version: "v3.1", ports: [80, 443] },
    ...agent("DOCKER01"),
  },
  {
    name: "shop.northwind.example",
    type: "DOMAIN",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Routed by a reverse proxy in Docker · proxied by Cloudflare",
    tags: ["cloudflare", "proxied"],
    ...agent("DOCKER01"),
  },
  {
    name: "api.northwind.example (APP02)",
    type: "APPLICATION",
    environment: "PRODUCTION",
    description: "nginx site on APP02 · https:443 api.northwind.example",
    tags: ["nginx"],
    metadata: { fqdn: "api.northwind.example", ports: [443] },
    ...agent("APP02"),
  },
  {
    name: "LB01",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Load balancer in front of the web servers",
    metadata: { hostname: "lb01", os: "Debian 12", ipAddresses: ["10.0.0.20"] },
    ...agent("LB01"),
  },
  {
    name: "web (LB01)",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "HAProxy frontend on LB01 · http:80, https:443",
    tags: ["haproxy"],
    metadata: { ports: [80, 443] },
    ...agent("LB01"),
  },
  // ── Kubernetes (agent-side collector, M25) ──
  {
    name: "k8s-node1",
    type: "SERVER",
    environment: "PRODUCTION",
    description: "Kubernetes node · cluster prod · v1.31.2",
    tags: ["kubernetes", "k8s:prod"],
    metadata: { hostname: "k8s-node1", os: "Ubuntu 24.04.1 LTS", ipAddresses: ["10.0.1.11"] },
    ...integration("Kubernetes prod via agent on k8s-node1"),
  },
  {
    name: "k8s-node2",
    type: "SERVER",
    environment: "PRODUCTION",
    description: "Kubernetes node · cluster prod · v1.31.2",
    tags: ["kubernetes", "k8s:prod"],
    metadata: { hostname: "k8s-node2", os: "Ubuntu 24.04.1 LTS", ipAddresses: ["10.0.1.12"] },
    ...integration("Kubernetes prod via agent on k8s-node1"),
  },
  {
    name: "shop/checkout",
    type: "APPLICATION",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Kubernetes Deployment in prod · ghcr.io/northwind/checkout:4.0.2 · 3/3 ready",
    tags: ["kubernetes", "k8s:prod", "ns:shop"],
    metadata: { version: "4.0.2", ports: [8080], ipAddresses: ["203.0.113.40"] },
    ...integration("Kubernetes prod via agent on k8s-node1"),
  },
  {
    name: "shop/orders-db",
    type: "DATABASE",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Kubernetes StatefulSet in prod · postgres:16 · 1/1 ready",
    tags: ["kubernetes", "k8s:prod", "ns:shop", "postgresql"],
    metadata: { version: "16", ports: [5432] },
    ...integration("Kubernetes prod via agent on k8s-node1"),
  },
  {
    name: "checkout.northwind.example",
    type: "DOMAIN",
    environment: "PRODUCTION",
    criticality: "CRITICAL",
    description: "Kubernetes Ingress in prod",
    tags: ["kubernetes"],
    ...integration("Kubernetes prod via agent on k8s-node1"),
  },
  // ── Hypervisors (agent-side collectors, M24) ──
  {
    name: "esx01.corp.local",
    type: "SERVER",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "ESXi host · cluster Office · VMware ESXi 8.0.3",
    tags: ["vmware"],
    metadata: { hostname: "esx01.corp.local", ipAddresses: ["10.0.0.6"] },
    ...integration("VMware via agent on DC01"),
  },
  {
    name: "FILE01",
    type: "VM",
    environment: "PRODUCTION",
    criticality: "MEDIUM",
    description: "VMware VM · 4 vCPU · 8 GB RAM · poweredOn",
    tags: ["vmware"],
    metadata: {
      hostname: "file01.corp.local",
      os: "Microsoft Windows Server 2022 (64-bit)",
      ipAddresses: ["10.0.0.31"],
    },
    ...integration("VMware via agent on DC01"),
  },
  {
    name: "PRINT01",
    type: "VM",
    environment: "PRODUCTION",
    criticality: "LOW",
    description: "VMware VM · 2 vCPU · 4 GB RAM · poweredOn",
    tags: ["vmware"],
    metadata: { os: "Microsoft Windows Server 2019 (64-bit)", ipAddresses: ["10.0.0.32"] },
    ...integration("VMware via agent on DC01"),
  },
  {
    name: "HV01",
    type: "SERVER",
    environment: "PRODUCTION",
    description: "Hyper-V host for the branch office",
    metadata: { hostname: "hv01", os: "Windows Server 2022", ipAddresses: ["10.20.0.5"] },
    ...agent("HV01"),
  },
  {
    name: "DC02",
    type: "VM",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Hyper-V VM · 2 vCPU · 4 GB RAM · Running",
    tags: ["hyper-v"],
    metadata: { ipAddresses: ["10.20.0.10"] },
    ...agent("HV01"),
  },
  {
    name: "xcp01",
    type: "SERVER",
    environment: "PRODUCTION",
    description: "XCP-ng host · pool Lab · XCP-ng 8.3.0",
    tags: ["xcp-ng"],
    metadata: { hostname: "xcp01", ipAddresses: ["10.0.0.7"] },
    ...integration("Xen Orchestra via agent on DC01"),
  },
  {
    name: "build-runner",
    type: "VM",
    environment: "DEVELOPMENT",
    description: "XCP-ng VM · 4 vCPU · 8 GB RAM · Running",
    tags: ["xcp-ng"],
    metadata: { os: "Debian GNU/Linux 12", ipAddresses: ["10.0.0.71"] },
    ...integration("Xen Orchestra via agent on DC01"),
  },
  {
    name: "pihole",
    type: "CONTAINER",
    environment: "PRODUCTION",
    description: "LXC 105 · running · 1 GB RAM",
    tags: ["proxmox"],
    ...integration("Proxmox via agent on PVE01"),
  },
  // ── Clouds (integrations, M8b, M23) ──
  {
    name: "web-eu-1",
    type: "VM",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Hetzner Cloud · cx22 · fsn1 · running",
    tags: ["hetzner"],
    metadata: { os: "Ubuntu 24.04", ipAddresses: ["203.0.113.10", "10.100.0.2"] },
    ...integration("Hetzner Cloud “Hetzner prod”"),
  },
  {
    name: "web-eu-2",
    type: "VM",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Hetzner Cloud · cx22 · fsn1 · running",
    tags: ["hetzner"],
    metadata: { os: "Ubuntu 24.04", ipAddresses: ["203.0.113.11", "10.100.0.3"] },
    ...integration("Hetzner Cloud “Hetzner prod”"),
  },
  {
    name: "lb-web",
    type: "NETWORK",
    environment: "PRODUCTION",
    criticality: "HIGH",
    description: "Hetzner Cloud load balancer · fsn1",
    tags: ["hetzner", "load-balancer"],
    metadata: { ipAddresses: ["203.0.113.99"], ports: [80, 443] },
    ...integration("Hetzner Cloud “Hetzner prod”"),
  },
  {
    name: "db-analytics",
    type: "DATABASE",
    environment: "PRODUCTION",
    description: "DigitalOcean managed PostgreSQL · db-s-1vcpu-2gb · ams3",
    tags: ["digitalocean", "managed-database", "postgresql"],
    metadata: { version: "16", ports: [25060] },
    ...integration("DigitalOcean “Analytics”"),
  },
  {
    name: "mail-relay",
    type: "VM",
    environment: "PRODUCTION",
    description: "i-0a1b2c3d4e · t3.small · eu-west-1a · running",
    tags: ["aws"],
    metadata: { os: "Linux/UNIX", ipAddresses: ["172.31.5.20"] },
    ...integration("AWS “eu-west-1”"),
  },
  {
    name: "entra-sync",
    type: "VM",
    environment: "PRODUCTION",
    description: "Standard_B2s · westeurope · rg identity",
    tags: ["azure"],
    metadata: { os: "Windows", ipAddresses: ["10.50.0.4"] },
    ...integration("Azure “Identity”"),
  },
  {
    name: "vps-backup",
    type: "VM",
    environment: "PRODUCTION",
    description: "OVHcloud VPS · 2 vCores / 4 GB RAM · os-gra9",
    tags: ["ovhcloud"],
    metadata: { hostname: "vps-backup.vps.ovh.net", ipAddresses: ["198.51.100.30"] },
    ...integration("OVHcloud “Backups”"),
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
  // Agent workloads
  ["Portal (APP01)", "RUNS_ON", "APP01"],
  ["Reporting (SQL01\\REPORTING)", "RUNS_ON", "SQL01"],
  ["shop-web (DOCKER01)", "RUNS_ON", "DOCKER01"],
  ["shop-db (DOCKER01)", "RUNS_ON", "DOCKER01"],
  ["shop-cache (DOCKER01)", "RUNS_ON", "DOCKER01"],
  ["traefik (DOCKER01)", "RUNS_ON", "DOCKER01"],
  [
    "shop-web (DOCKER01)",
    "EXPOSED_THROUGH",
    "traefik (DOCKER01)",
    "Traefik route (container labels)",
  ],
  [
    "shop.northwind.example",
    "DEPENDS_ON",
    "shop-web (DOCKER01)",
    "Reverse proxy route (container labels)",
  ],
  ["shop.northwind.example", "EXPOSED_THROUGH", "Cloudflare", "Proxied (Cloudflare DNS)"],
  ["api.northwind.example (APP02)", "RUNS_ON", "APP02"],
  ["web (LB01)", "RUNS_ON", "LB01"],
  ["Web", "EXPOSED_THROUGH", "web (LB01)"],
  // Kubernetes
  ["shop/checkout", "RUNS_ON", "k8s-node1"],
  ["shop/checkout", "RUNS_ON", "k8s-node2"],
  ["shop/orders-db", "RUNS_ON", "k8s-node2"],
  ["checkout.northwind.example", "DEPENDS_ON", "shop/checkout", "Ingress rule (Kubernetes API)"],
  ["checkout.northwind.example", "EXPOSED_THROUGH", "Cloudflare"],
  // Hypervisors
  ["esx01.corp.local", "HOSTS", "FILE01"],
  ["esx01.corp.local", "HOSTS", "PRINT01"],
  ["HV01", "HOSTS", "DC02"],
  ["xcp01", "HOSTS", "build-runner"],
  ["PVE01", "HOSTS", "pihole"],
  ["FILE01", "BACKS_UP_TO", "NAS01"],
  ["corp.local", "DEPENDS_ON", "DC02"],
  // Clouds
  ["web-eu-1", "EXPOSED_THROUGH", "lb-web", "Load balancer backend (Hetzner Cloud configuration)"],
  ["web-eu-2", "EXPOSED_THROUGH", "lb-web", "Load balancer backend (Hetzner Cloud configuration)"],
  ["entra-sync", "AUTHENTICATES_WITH", "corp.local"],
  ["SQL01", "BACKS_UP_TO", "vps-backup"],
];

// Suggestions without connection evidence: read from configuration, matched
// by InfraMole (reverse proxies, Compose depends_on) — awaiting review.
export const SUGGESTED: [string, string, string][] = [
  [
    "api.northwind.example (APP02)",
    "CustomerAPI",
    "Reverse proxy to 127.0.0.1:8080 (nginx site configuration)",
  ],
  ["web (LB01)", "APP01", "Reverse proxy to 10.0.0.23:443 (HAProxy frontend configuration)"],
  ["web (LB01)", "APP02", "Reverse proxy to 10.0.0.24:443 (HAProxy frontend configuration)"],
  ["shop-web (DOCKER01)", "shop-db (DOCKER01)", "Compose depends_on: db"],
  ["shop-web (DOCKER01)", "shop-cache (DOCKER01)", "Compose depends_on: cache"],
];

// [from, to, port, protocol guess, process, samples] — detected, awaiting review.
export const DETECTED: [string, string, number, string, string, number][] = [
  ["APP01", "SQL01", 1433, "MSSQL", "w3wp.exe", 128],
  ["APP02", "DC01", 389, "LDAP", "java", 42],
  ["APP01", "NAS01", 445, "SMB", "System", 12],
  ["shop/checkout", "db-analytics", 25060, "PostgreSQL", "checkout", 57],
  ["DOCKER01", "SQL01", 1433, "MSSQL", "dockerd", 33],
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
      data: { ...seed, workspaceId, source: seed.source ?? "MANUAL" },
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
  for (const [fromName, toName, note] of SUGGESTED) {
    const from = ids.get(fromName);
    const to = ids.get(toName);
    if (!from || !to) throw new Error(`Unknown resource in example data: ${fromName} / ${toName}`);
    const rel = await db.relationship.create({
      data: {
        workspaceId,
        fromResourceId: from,
        toResourceId: to,
        type: "DEPENDS_ON",
        note,
        origin: "DETECTED",
        status: "UNCONFIRMED",
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
        summary: `Suggested: ${fromName} depends on ${toName} (${note})`,
        resourceIds: [from, to],
      },
    });
  }
  return {
    resources: RESOURCES.length,
    relationships: RELATIONSHIPS.length,
    suggestions: DETECTED.length + SUGGESTED.length,
  };
}
