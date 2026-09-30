// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform exports (ADR-017, option A): JSON produced by the platform's own CLI,
 * uploaded by the user — no credentials ever reach InfraMole. PURE, unit tested.
 *
 *   Proxmox  pvesh get /cluster/resources --output-format json
 *   Azure    az vm list -d --output json
 *   AWS      aws ec2 describe-instances --output json
 *            aws rds describe-db-instances --output json
 */
import type { ImportBatch, ImportFormat, RowError } from "./parse";
import { buildResourceRow } from "./parse";

export type PlatformFormat = "proxmox" | "azure" | "aws" | "cloudflare" | "workloads";

/** Detects a platform export inside already-parsed JSON (null = generic JSON). */
export function detectPlatform(data: unknown): PlatformFormat | null {
  const result = (data as { result?: unknown })?.result;
  if (Array.isArray(result) && result.some((r) => r && typeof r === "object" && "proxied" in r)) {
    return "cloudflare";
  }
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    if (typeof first?.id === "string" && /^(qemu|lxc|node|storage|sdn)\//.test(first.id))
      return "proxmox";
    if (first && ("storageProfile" in first || "hardwareProfile" in first || "vmId" in first))
      return "azure";
  }
  if (data && typeof data === "object" && ("Reservations" in data || "DBInstances" in data))
    return "aws";
  return null;
}

export function parsePlatform(format: PlatformFormat, data: unknown): ImportBatch {
  const batch: ImportBatch = {
    format: format as ImportFormat,
    resources: [],
    relationships: [],
    errors: [],
    warnings: [],
  };
  if (format === "proxmox") proxmox(batch, data);
  else if (format === "workloads") workloads(batch, data);
  else if (format === "azure") azure(batch, data);
  else if (format === "cloudflare") cloudflare(batch, data);
  else aws(batch, data);
  return batch;
}

// ───────────────────────── Workloads (M16 Windows, M20 Linux) ─────────────────────────

type SiteInput = { name: string; bindings: { protocol: string; port: number; host?: string }[] };
type DatabaseInput = { instance: string; name: string };

/** What ingestion passes for one agent host (built from a validated report). */
export interface WorkloadsInput {
  host: { id: string; name: string };
  iisSites?: SiteInput[];
  nginxSites?: SiteInput[];
  apacheSites?: SiteInput[];
  sqlDatabases?: DatabaseInput[];
  postgresDatabases?: DatabaseInput[];
  mysqlDatabases?: DatabaseInput[];
}

const SITE_KINDS = [
  { field: "iisSites", key: "iis", tag: "iis", label: "IIS site" },
  { field: "nginxSites", key: "nginx", tag: "nginx", label: "nginx site" },
  { field: "apacheSites", key: "apache", tag: "apache", label: "Apache site" },
] as const;

const DATABASE_KINDS = [
  {
    field: "sqlDatabases",
    key: "mssql",
    tag: "sql-server",
    label: "SQL Server database",
    system: ["master", "model", "msdb", "tempdb"],
    /** Default instance names that are not shown in the resource name. */
    defaultInstance: (i: string) => i.toUpperCase() === "MSSQLSERVER",
    instanceLabel: (i: string) => `instance ${i}`,
  },
  {
    field: "postgresDatabases",
    key: "postgresql",
    tag: "postgresql",
    label: "PostgreSQL database",
    system: ["postgres", "template0", "template1"],
    defaultInstance: (i: string) => i === "5432",
    instanceLabel: (i: string) => `port ${i}`,
  },
  {
    field: "mysqlDatabases",
    key: "mysql",
    tag: "mysql",
    label: "MySQL / MariaDB database",
    system: ["information_schema", "mysql", "performance_schema", "sys"],
    defaultInstance: (i: string) => i === "default",
    instanceLabel: (i: string) => `instance ${i}`,
  },
] as const;

/**
 * Web sites → APPLICATION, databases → DATABASE, each RUNS_ON the agent's
 * host (confirmed: the agent read it on that machine; origin DETECTED).
 * Names carry the host so "Default Web Site" on twenty servers stays twenty
 * distinguishable resources. Keys include the host id and the kind.
 */
function workloads(batch: ImportBatch, data: unknown) {
  const input = data as WorkloadsInput;
  const host = input?.host;
  if (!host?.id || !host.name) {
    batch.errors.push({ row: 0, message: "Workloads need their host." });
    return;
  }
  const hostRef = `id:${host.id}`;
  let row = 0;
  const runsOn = (key: string, note: string) =>
    batch.relationships.push({
      row,
      from: key,
      to: hostRef,
      type: "RUNS_ON",
      note,
      suggested: false,
    });

  for (const kind of SITE_KINDS) {
    for (const site of input[kind.field] ?? []) {
      row++;
      const bindings = site.bindings ?? [];
      const ports = [...new Set(bindings.map((b) => b.port))].sort((a, b) => a - b);
      const hostNames = [
        ...new Set(bindings.map((b) => b.host?.toLowerCase()).filter((h): h is string => !!h)),
      ];
      const key = `${host.id}/${kind.key}/${site.name.toLowerCase()}`;
      const r = add(batch, row, {
        id: key,
        name: `${site.name} (${host.name})`,
        type: "APPLICATION",
        description: [
          `${kind.label} on ${host.name}`,
          bindings.length
            ? bindings.map((b) => `${b.protocol}:${b.port}${b.host ? ` ${b.host}` : ""}`).join(", ")
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        fqdn: hostNames[0],
        ports,
        tags: [kind.tag],
      });
      if (r) runsOn(key, `${kind.label} (reported by the agent)`);
    }
  }

  for (const kind of DATABASE_KINDS) {
    const system = new Set<string>(kind.system);
    for (const db of input[kind.field] ?? []) {
      if (system.has(db.name.toLowerCase())) continue;
      row++;
      const named = !kind.defaultInstance(db.instance);
      const where = named ? `${host.name}\\${db.instance}` : host.name;
      const key = `${host.id}/${kind.key}/${db.instance.toLowerCase()}/${db.name.toLowerCase()}`;
      const r = add(batch, row, {
        id: key,
        name: `${db.name} (${where})`,
        type: "DATABASE",
        description: `${kind.label} on ${host.name}${named ? `, ${kind.instanceLabel(db.instance)}` : ""}`,
        tags: [kind.tag],
      });
      if (r) runsOn(key, `${kind.label} (reported by the agent)`);
    }
  }
}

// ───────────────────────── Cloudflare ─────────────────────────

interface CfRecord {
  name: string;
  type: string;
  content: string;
  proxied?: boolean;
  zone_name?: string;
}

/**
 * DNS records (API `GET /zones/:id/dns_records` response, one or more zones
 * concatenated in `result`) → DOMAIN resources. Proxied records are
 * EXPOSED_THROUGH Cloudflare; A/AAAA records DEPEND_ON the resource owning
 * the origin IP (resolved against the Library, skipped if unknown); CNAMEs
 * DEPEND_ON their target when it is in the same export.
 */
function cloudflare(batch: ImportBatch, data: unknown) {
  const records = (((data as { result?: CfRecord[] })?.result ?? []) as CfRecord[]).filter((r) =>
    ["A", "AAAA", "CNAME"].includes(r.type),
  );
  const byName = new Map<string, CfRecord[]>();
  for (const r of records) {
    const name = r.name.toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  let row = 0;
  let anyProxied = false;
  for (const [name, recs] of byName) {
    row++;
    const ips = recs.filter((r) => r.type !== "CNAME").map((r) => r.content);
    const cname = recs.find((r) => r.type === "CNAME")?.content.toLowerCase();
    const proxied = recs.some((r) => r.proxied);
    anyProxied ||= proxied;
    add(batch, row, {
      id: `dns/${name}`,
      name,
      type: "DOMAIN",
      description: [
        cname ? `CNAME → ${cname}` : `${recs[0]!.type} record`,
        proxied && "proxied by Cloudflare",
      ]
        .filter(Boolean)
        .join(" · "),
      ips,
      tags: ["cloudflare", ...(proxied ? ["proxied"] : [])],
    });
    const self = `dns/${name}`;
    if (proxied) {
      batch.relationships.push({
        row,
        from: self,
        to: "Cloudflare",
        type: "EXPOSED_THROUGH",
        note: "Proxied (Cloudflare DNS)",
        suggested: false,
      });
    }
    for (const ip of ips) {
      batch.relationships.push({
        row,
        from: self,
        to: `ip:${ip}`,
        type: "DEPENDS_ON",
        note: `DNS ${name} → ${ip}`,
        suggested: false,
        optional: true,
      });
    }
    if (cname && byName.has(cname)) {
      batch.relationships.push({
        row,
        from: self,
        to: `dns/${cname}`,
        type: "DEPENDS_ON",
        note: `CNAME → ${cname}`,
        suggested: false,
      });
    }
  }
  if (anyProxied) {
    add(batch, ++row, {
      id: "cloudflare",
      name: "Cloudflare",
      type: "EXTERNAL_SERVICE",
      description: "CDN / reverse proxy",
      tags: ["cloudflare"],
    });
  }
  if (records.length === 0)
    batch.errors.push({ row: 0, message: "No A, AAAA or CNAME records found." });
}

function add(batch: ImportBatch, row: number, fields: Record<string, unknown>) {
  const r = buildResourceRow(row, fields);
  if ("message" in r) batch.errors.push(r as RowError);
  else batch.resources.push(r);
  return "message" in r ? null : r;
}

const gb = (bytes: unknown) =>
  typeof bytes === "number" && bytes > 0 ? `${Math.round(bytes / 1024 ** 3)} GB RAM` : null;

const cleanTag = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/** Cloud tags → our tags (key:value) + environment from env/environment tags. */
function fromCloudTags(tags: Record<string, string>): { tags: string[]; environment?: string } {
  const out: string[] = [];
  let environment: string | undefined;
  for (const [k, v] of Object.entries(tags)) {
    if (/^(env|environment|stage)$/i.test(k)) environment = v;
    if (/^name$/i.test(k)) continue;
    const t = cleanTag(v ? `${k}:${v}` : k);
    if (t && /^[a-z0-9]/.test(t)) out.push(t);
  }
  return { tags: [...new Set(out)].slice(0, 18), environment };
}

// ───────────────────────── Proxmox ─────────────────────────

interface PveResource {
  id: string;
  type: string;
  node?: string;
  name?: string;
  vmid?: number;
  status?: string;
  maxmem?: number;
  template?: number;
}

function proxmox(batch: ImportBatch, data: unknown) {
  const items = (Array.isArray(data) ? data : []) as PveResource[];
  const nodes = new Set(items.filter((i) => i.type === "node" && i.node).map((i) => i.node!));
  // Nodes referenced by guests but missing from the export still get a resource.
  for (const i of items) if ((i.type === "qemu" || i.type === "lxc") && i.node) nodes.add(i.node);

  let row = 0;
  for (const node of [...nodes].sort()) {
    add(batch, ++row, {
      id: `node/${node}`,
      name: node,
      type: "SERVER",
      description: "Proxmox VE node",
      tags: ["proxmox"],
      hostname: node,
    });
  }
  for (const i of items) {
    if (i.type !== "qemu" && i.type !== "lxc") continue;
    row++;
    if (i.template === 1) {
      batch.warnings.push(`Skipped template ${i.name ?? i.id}.`);
      continue;
    }
    const kind = i.type === "qemu" ? "VM" : "CONTAINER";
    const created = add(batch, row, {
      id: i.id,
      name: i.name ?? `${i.type}-${i.vmid}`,
      type: kind,
      description: [i.type === "qemu" ? `VM ${i.vmid}` : `LXC ${i.vmid}`, i.status, gb(i.maxmem)]
        .filter(Boolean)
        .join(" · "),
      tags: ["proxmox"],
    });
    if (created && i.node) {
      // Placement reported by the hypervisor itself: a fact, not an inference.
      batch.relationships.push({
        row,
        from: `node/${i.node}`,
        to: i.id.toLowerCase(),
        type: "HOSTS",
        note: "Reported by Proxmox (/cluster/resources)",
        suggested: false,
      });
    }
  }
  if (batch.resources.length === 0)
    batch.errors.push({ row: 0, message: "No Proxmox nodes, VMs or containers found." });
}

// ───────────────────────── Azure ─────────────────────────

interface AzureVm {
  id?: string;
  name?: string;
  resourceGroup?: string;
  location?: string;
  privateIps?: string;
  publicIps?: string;
  powerState?: string;
  hardwareProfile?: { vmSize?: string };
  storageProfile?: {
    osDisk?: { osType?: string };
    imageReference?: { offer?: string; sku?: string };
  };
  tags?: Record<string, string> | null;
}

function azure(batch: ImportBatch, data: unknown) {
  const vms = (Array.isArray(data) ? data : []) as AzureVm[];
  vms.forEach((vm, i) => {
    const t = fromCloudTags(vm.tags ?? {});
    const ips = [vm.privateIps, vm.publicIps]
      .filter(Boolean)
      .flatMap((s) => String(s).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    const image = vm.storageProfile?.imageReference;
    add(batch, i + 1, {
      id: (vm.id ?? `${vm.resourceGroup}/${vm.name}`).toLowerCase(),
      name: vm.name,
      type: "VM",
      environment: t.environment,
      description: [
        vm.hardwareProfile?.vmSize,
        vm.location,
        vm.resourceGroup && `rg ${vm.resourceGroup}`,
        vm.powerState,
      ]
        .filter(Boolean)
        .join(" · "),
      os: [vm.storageProfile?.osDisk?.osType, image?.offer, image?.sku].filter(Boolean).join(" "),
      ips,
      tags: ["azure", ...t.tags],
    });
  });
  if (vms.length === 0)
    batch.errors.push({ row: 0, message: "No Azure VMs found (expected `az vm list -d` output)." });
}

// ───────────────────────── AWS ─────────────────────────

interface Ec2Instance {
  InstanceId: string;
  InstanceType?: string;
  PrivateIpAddress?: string;
  PublicIpAddress?: string;
  PrivateDnsName?: string;
  PlatformDetails?: string;
  State?: { Name?: string };
  Placement?: { AvailabilityZone?: string };
  Tags?: { Key: string; Value: string }[];
}

interface RdsInstance {
  DBInstanceIdentifier: string;
  Engine?: string;
  EngineVersion?: string;
  DBInstanceClass?: string;
  Endpoint?: { Address?: string; Port?: number };
  TagList?: { Key: string; Value: string }[];
}

function aws(batch: ImportBatch, data: unknown) {
  const doc = (data ?? {}) as {
    Reservations?: { Instances?: Ec2Instance[] }[];
    DBInstances?: RdsInstance[];
  };
  let row = 0;
  for (const reservation of doc.Reservations ?? []) {
    for (const inst of reservation.Instances ?? []) {
      row++;
      const tags = Object.fromEntries((inst.Tags ?? []).map((t) => [t.Key, t.Value]));
      const t = fromCloudTags(tags);
      if (inst.State?.Name === "terminated") {
        batch.warnings.push(`Skipped terminated instance ${inst.InstanceId}.`);
        continue;
      }
      add(batch, row, {
        id: inst.InstanceId,
        name: tags.Name || tags.name || inst.InstanceId,
        type: "VM",
        environment: t.environment,
        description: [
          inst.InstanceId,
          inst.InstanceType,
          inst.Placement?.AvailabilityZone,
          inst.State?.Name,
        ]
          .filter(Boolean)
          .join(" · "),
        os: inst.PlatformDetails,
        hostname: inst.PrivateDnsName,
        ips: [inst.PrivateIpAddress, inst.PublicIpAddress].filter(Boolean),
        tags: ["aws", ...t.tags],
      });
    }
  }
  for (const db of doc.DBInstances ?? []) {
    row++;
    const tags = Object.fromEntries((db.TagList ?? []).map((t) => [t.Key, t.Value]));
    const t = fromCloudTags(tags);
    add(batch, row, {
      id: `rds/${db.DBInstanceIdentifier}`,
      name: db.DBInstanceIdentifier,
      type: "DATABASE",
      environment: t.environment,
      description: [
        `RDS ${db.Engine ?? ""}`.trim(),
        db.DBInstanceClass,
        db.Endpoint?.Port && `port ${db.Endpoint.Port}`,
      ]
        .filter(Boolean)
        .join(" · "),
      hostname: db.Endpoint?.Address,
      version: db.EngineVersion,
      tags: ["aws", "rds", ...t.tags],
    });
  }
  if (row === 0) batch.errors.push({ row: 0, message: "No EC2 instances or RDS databases found." });
}
