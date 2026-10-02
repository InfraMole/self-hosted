// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform exports (ADR-017, option A): JSON produced by the platform's own CLI,
 * uploaded by the user — no credentials ever reach InfraMole. PURE, unit tested.
 *
 *   Proxmox  pvesh get /cluster/resources --output-format json
 *   Azure    az vm list -d --output json
 *   AWS      aws ec2 describe-instances --output json
 *            aws rds describe-db-instances --output json
 *   Cloud    normalised inventory built by the API integrations of smaller
 *            clouds (Hetzner, DigitalOcean, Scaleway, OVHcloud, Google Cloud,
 *            Clouding — M23, ADR-034); see `CloudInventory`.
 */
import type { ImportBatch, ImportFormat, RowError } from "./parse";
import { buildResourceRow } from "./parse";

export type PlatformFormat =
  | "proxmox"
  | "azure"
  | "aws"
  | "cloudflare"
  | "workloads"
  | "cloud"
  | "hypervisor"
  | "kubernetes"
  | "tailscale"
  | "storage";

/** Detects a platform export inside already-parsed JSON (null = generic JSON). */
export function detectPlatform(data: unknown): PlatformFormat | null {
  const doc = data as { provider?: unknown; servers?: unknown } | null;
  if (
    doc &&
    typeof doc.provider === "string" &&
    (CLOUD_PROVIDERS as readonly string[]).includes(doc.provider) &&
    Array.isArray(doc.servers)
  )
    return "cloud";
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
  // The Azure integration's document (M27).
  if (data && typeof data === "object" && Array.isArray((data as AzureDoc).virtualMachines))
    return "azure";
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
  else if (format === "cloud") cloud(batch, data);
  else if (format === "hypervisor") hypervisor(batch, data);
  else if (format === "kubernetes") kubernetes(batch, data);
  else if (format === "tailscale") tailscale(batch, data);
  else if (format === "storage") storage(batch, data);
  else aws(batch, data);
  return batch;
}

// ───────────────────────── Workloads (M16 Windows, M20 Linux) ─────────────────────────

type SiteInput = {
  name: string;
  bindings: { protocol: string; port: number; host?: string }[];
  /** Reverse-proxy targets (M25). */
  upstreams?: { host: string; port: number }[];
};
type DatabaseInput = { instance: string; name: string };

/** What ingestion passes for one agent host (built from a validated report). */
export interface WorkloadsInput {
  host: { id: string; name: string };
  iisSites?: SiteInput[];
  nginxSites?: SiteInput[];
  haproxySites?: SiteInput[];
  apacheSites?: SiteInput[];
  sqlDatabases?: DatabaseInput[];
  postgresDatabases?: DatabaseInput[];
  mysqlDatabases?: DatabaseInput[];
  /** Docker (M25). */
  containers?: ContainerInput[];
}

export interface ContainerInput {
  name: string;
  image: string;
  state?: string;
  ports: { port: number; targetPort: number; protocol: string }[];
  project?: string;
  service?: string;
  dependsOn?: string[];
  hosts?: string[];
}

const SITE_KINDS = [
  { field: "iisSites", key: "iis", tag: "iis", label: "IIS site" },
  { field: "nginxSites", key: "nginx", tag: "nginx", label: "nginx site" },
  { field: "apacheSites", key: "apache", tag: "apache", label: "Apache site" },
  { field: "haproxySites", key: "haproxy", tag: "haproxy", label: "HAProxy frontend" },
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
      if (!r) continue;
      runsOn(key, `${kind.label} (reported by the agent)`);
      // M25: a proxied target is configuration, but matching it to a
      // resource is an inference → suggestion; unresolvable → warning.
      for (const u of site.upstreams ?? []) {
        batch.relationships.push({
          row,
          from: key,
          to: `endpoint:${host.id}|${u.host}|${u.port}`,
          type: "DEPENDS_ON",
          note: `Reverse proxy to ${u.host}:${u.port} (${kind.label.toLowerCase()} configuration)`,
          suggested: true,
          optional: true,
        });
      }
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
  containersOf(batch, input, hostRef, () => ++row);
}

/** What a container runs, from its image name (repository, without registry or tag). */
export function classifyImage(image: string): {
  tech: string | null;
  label: string;
  type: "DATABASE" | "CONTAINER";
  proxy?: "traefik" | "caddy" | "nginx" | "haproxy";
} {
  const repo = image
    .split("@")[0]!
    .replace(/:[^/:]+$/, "")
    .toLowerCase();
  const name = repo.split("/").pop()!;
  const db = (tech: string, label: string) => ({ tech, label, type: "DATABASE" as const });
  const app = (tech: string, label: string, proxy?: "traefik" | "caddy" | "nginx" | "haproxy") => ({
    tech,
    label,
    type: "CONTAINER" as const,
    ...(proxy ? { proxy } : {}),
  });
  if (/^(postgres|postgis|timescaledb)/.test(name) || repo.includes("postgis/"))
    return db("postgresql", "PostgreSQL");
  if (repo.includes("mssql/server") || ["mssql", "sqlserver", "sql-server"].includes(name))
    return db("sql-server", "SQL Server");
  if (name === "mysql" || name === "percona-server") return db("mysql", "MySQL");
  if (name === "mariadb") return db("mariadb", "MariaDB");
  if (name.startsWith("mongo")) return db("mongodb", "MongoDB");
  if (name === "redis" || name === "valkey" || name === "keydb") return db("redis", "Redis");
  if (name === "elasticsearch" || name === "opensearch")
    return db(name, name === "opensearch" ? "OpenSearch" : "Elasticsearch");
  if (
    name === "influxdb" ||
    name === "clickhouse-server" ||
    name === "cassandra" ||
    name === "couchdb"
  )
    return db(name.replace("-server", ""), name);
  if (name === "traefik") return app("traefik", "Traefik", "traefik");
  if (name === "caddy" || name === "caddy-docker-proxy") return app("caddy", "Caddy", "caddy");
  if (
    name === "nginx" ||
    name === "nginx-proxy" ||
    name === "nginx-proxy-manager" ||
    name === "openresty"
  )
    return app("nginx", "nginx", "nginx");
  if (name === "haproxy") return app("haproxy", "HAProxy", "haproxy");
  if (name === "httpd" || name === "apache") return app("apache", "Apache");
  if (name === "rabbitmq") return app("rabbitmq", "RabbitMQ");
  if (name === "kafka" || repo.includes("cp-kafka")) return app("kafka", "Kafka");
  return { tech: null, label: "container", type: "CONTAINER" };
}

/**
 * Docker containers (M25): DATABASE for database engines, CONTAINER for the
 * rest, each RUNS_ON the host (CONFIRMED). Compose depends_on → DEPENDS_ON
 * suggestions (a declaration, not observed traffic). A host name routed by
 * a Traefik / Caddy container → DOMAIN that DEPENDS_ON the container, which
 * is EXPOSED_THROUGH the proxy (both read from the proxy's configuration).
 * Keys use the Compose project/service when present: recreated containers
 * keep their identity.
 */
function containersOf(
  batch: ImportBatch,
  input: WorkloadsInput,
  hostRef: string,
  nextRow: () => number,
) {
  const host = input.host;
  const list = input.containers ?? [];
  const keyOf = (c: ContainerInput) =>
    `${host.id}/docker/${(c.project && c.service ? `${c.project}/${c.service}` : c.name).toLowerCase()}`;
  const byService = new Map<string, string>();
  for (const c of list)
    if (c.project && c.service) byService.set(`${c.project}/${c.service}`.toLowerCase(), keyOf(c));
  const proxies = list.filter(
    (c) => classifyImage(c.image).proxy === "traefik" || classifyImage(c.image).proxy === "caddy",
  );
  const proxyKey = proxies.length === 1 ? keyOf(proxies[0]!) : null;

  const seen = new Set<string>();
  for (const c of list) {
    const key = keyOf(c);
    if (seen.has(key)) continue; // scaled services: one resource per service
    seen.add(key);
    const row = nextRow();
    // An untagged image ("sha256:…"): the service / container name is the best hint.
    const kind = c.image.startsWith("sha256:")
      ? classifyImage(c.service ?? c.name)
      : classifyImage(c.image);
    const tag = c.image.split("@")[0]!.match(/:([^/:]+)$/)?.[1];
    const r = add(batch, row, {
      id: key,
      name: `${c.project && c.service ? `${c.project}-${c.service}` : c.name} (${host.name})`,
      type: kind.type,
      description: [
        `${kind.label === "container" ? "Docker container" : `${kind.label} in Docker`} on ${host.name}`,
        c.image,
        c.state,
      ]
        .filter(Boolean)
        .join(" · "),
      version: tag && tag !== "latest" ? tag : undefined,
      ports: [...new Set(c.ports.filter((p) => p.protocol === "tcp").map((p) => p.port))].sort(
        (a, b) => a - b,
      ),
      tags: [
        "docker",
        ...(kind.tech ? [kind.tech] : []),
        ...(c.project ? [`compose:${c.project.toLowerCase()}`] : []),
      ],
    });
    if (!r) continue;
    batch.relationships.push({
      row,
      from: key,
      to: hostRef,
      type: "RUNS_ON",
      note: "Docker container (reported by the agent)",
      suggested: false,
    });
    for (const dep of c.dependsOn ?? []) {
      const target = c.project ? byService.get(`${c.project}/${dep}`.toLowerCase()) : undefined;
      if (target && target !== key)
        batch.relationships.push({
          row,
          from: key,
          to: target,
          type: "DEPENDS_ON",
          note: `Compose depends_on: ${dep}`,
          suggested: true,
        });
    }
    for (const name of [...new Set((c.hosts ?? []).map((h) => h.toLowerCase()))]) {
      const domainKey = `dns/${name}`;
      if (!batch.resources.some((x) => x.key === domainKey)) {
        add(batch, row, {
          id: domainKey,
          name,
          type: "DOMAIN",
          description: "Routed by a reverse proxy in Docker",
          tags: ["docker"],
        });
      }
      batch.relationships.push({
        row,
        from: domainKey,
        to: key,
        type: "DEPENDS_ON",
        note: "Reverse proxy route (container labels)",
        suggested: false,
      });
    }
    if (c.hosts?.length && proxyKey && proxyKey !== key)
      batch.relationships.push({
        row,
        from: key,
        to: proxyKey,
        type: "EXPOSED_THROUGH",
        note: "Reverse proxy route (container labels)",
        suggested: false,
      });
  }
}

// ───────────────────────── DNS (Cloudflare M8b, other providers M27) ─────────────────────────

/** One DNS record, absolute names (no trailing dot). */
export interface DnsRecord {
  name: string;
  type: string;
  content: string;
  /** Cloudflare only: traffic goes through Cloudflare's proxy. */
  proxied?: boolean;
  zone?: string;
}

interface CfRecord extends DnsRecord {
  zone_name?: string;
}

/**
 * DNS records (API `GET /zones/:id/dns_records` response, one or more zones
 * concatenated in `result`) → DOMAIN resources. Proxied records are
 * EXPOSED_THROUGH Cloudflare; see `dnsRecords` for the rest.
 */
function cloudflare(batch: ImportBatch, data: unknown) {
  const records = ((data as { result?: CfRecord[] })?.result ?? []) as CfRecord[];
  const kept = dnsRecords(batch, records, { tag: "cloudflare", proxy: "Cloudflare" }, 0);
  if (kept === 0) batch.errors.push({ row: 0, message: "No A, AAAA or CNAME records found." });
}

/**
 * DNS records → one DOMAIN per name. A/AAAA records DEPEND_ON the resource
 * owning the IP (resolved against the Library, skipped if unknown); a CNAME
 * DEPENDS_ON its target when that is a record of the same export or a
 * resource of the same batch with that host name (an RDS endpoint, a load
 * balancer's DNS name). Names with a label starting with "_" (DKIM, SRV,
 * ACME…) never name a host. Returns how many names were imported.
 */
export function dnsRecords(
  batch: ImportBatch,
  all: readonly DnsRecord[],
  opts: { tag: string; label?: string; proxy?: string },
  firstRow: number,
): number {
  const records = all.filter(
    (r) =>
      ["A", "AAAA", "CNAME"].includes(r.type) &&
      typeof r.name === "string" &&
      typeof r.content === "string" &&
      !r.name.split(".").some((label) => label.startsWith("_")),
  );
  const byName = new Map<string, DnsRecord[]>();
  for (const r of records) {
    const name = r.name.toLowerCase().replace(/\.$/, "");
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  // Host names and IPs of what this batch already imports (servers, databases,
  // load balancers): a first sync links its records without waiting for the Library.
  const byHost = new Map<string, string>();
  const byIp = new Map<string, string[]>();
  for (const r of batch.resources) {
    if (r.input.type === "DOMAIN") continue;
    for (const h of [r.input.metadata?.hostname, r.input.metadata?.fqdn])
      if (h) byHost.set(h.toLowerCase().replace(/\.$/, ""), r.key);
    for (const ip of r.input.metadata?.ipAddresses ?? [])
      byIp.set(ip.toLowerCase(), [...(byIp.get(ip.toLowerCase()) ?? []), r.key]);
  }
  let row = firstRow;
  let anyProxied = false;
  for (const [name, recs] of byName) {
    row++;
    const ips = recs.filter((r) => r.type !== "CNAME").map((r) => r.content);
    const cname = recs
      .find((r) => r.type === "CNAME")
      ?.content.toLowerCase()
      .replace(/\.$/, "");
    const proxied = !!opts.proxy && recs.some((r) => r.proxied);
    anyProxied ||= proxied;
    add(batch, row, {
      id: `dns/${name}`,
      name,
      type: "DOMAIN",
      description: [
        cname ? `CNAME → ${cname}` : `${recs[0]!.type} record`,
        opts.label && `${opts.label} DNS`,
        proxied && `proxied by ${opts.proxy}`,
      ]
        .filter(Boolean)
        .join(" · "),
      ips,
      tags: [opts.tag, ...(proxied ? ["proxied"] : [])],
    });
    const self = `dns/${name}`;
    if (proxied) {
      batch.relationships.push({
        row,
        from: self,
        to: opts.proxy!,
        type: "EXPOSED_THROUGH",
        note: `Proxied (${opts.proxy} DNS)`,
        suggested: false,
      });
    }
    for (const ip of ips) {
      const own = byIp.get(ip.toLowerCase());
      batch.relationships.push({
        row,
        from: self,
        to: own?.length === 1 ? own[0]! : `ip:${ip}`,
        type: "DEPENDS_ON",
        note: `DNS ${name} → ${ip}`,
        suggested: false,
        optional: true,
      });
    }
    const target = cname && (byName.has(cname) ? `dns/${cname}` : byHost.get(cname));
    if (target) {
      batch.relationships.push({
        row,
        from: self,
        to: target,
        type: "DEPENDS_ON",
        note: `CNAME → ${cname}`,
        suggested: false,
      });
    }
  }
  if (anyProxied) {
    add(batch, ++row, {
      id: opts.proxy!.toLowerCase(),
      name: opts.proxy,
      type: "EXTERNAL_SERVICE",
      description: "CDN / reverse proxy",
      tags: [opts.tag],
    });
  }
  return byName.size;
}

/**
 * Absolute name of a zone-relative DNS name or target: "@" → the zone, a
 * name with a trailing dot → as is, a single label → under the zone, a
 * dotted name → treated as absolute.
 */
export function absoluteName(value: string, zone: string): string {
  const v = value.trim().toLowerCase();
  const z = zone.toLowerCase().replace(/\.$/, "");
  if (v === "@" || v === "") return z;
  if (v.endsWith(".")) return v.slice(0, -1);
  if (v === z || v.endsWith(`.${z}`)) return v;
  return v.includes(".") ? v : `${v}.${z}`;
}

// ───────────────────────── Cloud inventory (M23) ─────────────────────────

export const CLOUD_PROVIDERS = [
  "hetzner",
  "digitalocean",
  "scaleway",
  "ovhcloud",
  "gcp",
  "clouding",
  "vultr",
  "linode",
  "ionos",
  "oci",
] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

const CLOUD_LABELS: Record<CloudProvider, string> = {
  hetzner: "Hetzner Cloud",
  digitalocean: "DigitalOcean",
  scaleway: "Scaleway",
  ovhcloud: "OVHcloud",
  gcp: "Google Cloud",
  clouding: "Clouding",
  vultr: "Vultr",
  linode: "Akamai Cloud (Linode)",
  ionos: "IONOS Cloud",
  oci: "Oracle Cloud",
};

export interface CloudServer {
  id: string;
  name: string;
  /** "SERVER" for bare metal (OVHcloud dedicated); default VM. */
  kind?: "VM" | "SERVER";
  hostname?: string;
  region?: string;
  size?: string;
  os?: string;
  status?: string;
  ips?: string[];
  labels?: Record<string, string>;
}

export interface CloudLoadBalancer {
  id: string;
  name: string;
  /** Description override, e.g. "AWS Application Load Balancer". */
  kind?: string;
  region?: string;
  /** DNS name of the load balancer (AWS), for CNAME / alias records. */
  hostname?: string;
  ips?: string[];
  ports?: number[];
  /**
   * Backends as configured in the provider: a server id of this inventory,
   * another load balancer of it, an IP, or a host name.
   */
  targets?: { server?: string; lb?: string; ip?: string; host?: string }[];
  labels?: Record<string, string>;
}

export interface CloudDatabase {
  id: string;
  name: string;
  engine?: string;
  version?: string;
  region?: string;
  size?: string;
  hostname?: string;
  ips?: string[];
  port?: number;
  labels?: Record<string, string>;
}

/** What the integrations of M23 produce: one provider account (project / zones). */
export interface CloudInventory {
  provider: CloudProvider;
  servers: CloudServer[];
  loadBalancers?: CloudLoadBalancer[];
  databases?: CloudDatabase[];
  /** DNS records of the provider's zones (M27), already filtered by the integration. */
  dns?: DnsRecord[];
}

/**
 * Servers → VM (or SERVER), managed databases → DATABASE, load balancers →
 * NETWORK. A backend configured on a load balancer is EXPOSED_THROUGH it:
 * configuration read from the provider, so a fact (not a suggestion). IP
 * backends resolve against the Library and are skipped when unknown.
 * Keys carry the provider, so ids of two providers never collide.
 */
function cloud(batch: ImportBatch, data: unknown) {
  const inv = (data ?? {}) as Partial<CloudInventory>;
  const provider = inv.provider;
  if (!provider || !(CLOUD_PROVIDERS as readonly string[]).includes(provider)) {
    batch.errors.push({ row: 0, message: "Unknown cloud provider." });
    return;
  }
  const label = CLOUD_LABELS[provider];
  const key = (kind: string, id: string) => `${provider}/${kind}/${String(id).toLowerCase()}`;
  const unique = (ips?: string[]) => [...new Set((ips ?? []).filter(Boolean))];
  let row = 0;
  const serverKeys = new Set<string>();

  for (const s of inv.servers ?? []) {
    row++;
    const t = fromCloudTags(s.labels ?? {});
    const created = add(batch, row, {
      id: key("server", s.id),
      name: s.name,
      type: s.kind ?? "VM",
      environment: t.environment,
      description: [label, s.size, s.region, s.status].filter(Boolean).join(" · "),
      os: s.os,
      hostname: s.hostname,
      ips: unique(s.ips),
      tags: [provider, ...t.tags],
    });
    if (created) serverKeys.add(key("server", s.id));
  }

  const opts = {
    label,
    tag: provider,
    key: (id: string) => key("lb", id),
    serverKey: (id: string) => key("server", id),
    serverKeys,
  };
  row = cloudDatabases(batch, inv.databases ?? [], { ...opts, key: (id) => key("db", id) }, row);
  row = cloudLoadBalancers(batch, inv.loadBalancers ?? [], opts, row);

  if (inv.dns?.length) row += dnsRecords(batch, inv.dns, { tag: provider, label }, row);

  if (row === 0) batch.warnings.push(`No servers, databases or load balancers found in ${label}.`);
}

interface CloudSectionOptions {
  /** Shown in descriptions and notes, e.g. "Hetzner Cloud". */
  label: string;
  /** First tag of every resource, e.g. "hetzner". */
  tag: string;
  /** Batch key of an item of this section. */
  key: (id: string) => string;
  /** Batch key of a server of the same inventory (load balancer targets). */
  serverKey?: (id: string) => string;
  serverKeys?: Set<string>;
}

const uniqueIps = (ips?: (string | undefined)[]) => [
  ...new Set((ips ?? []).filter((ip): ip is string => !!ip)),
];

/** Managed databases → DATABASE (shared by the cloud, AWS and Azure formats). */
function cloudDatabases(
  batch: ImportBatch,
  dbs: readonly CloudDatabase[],
  o: CloudSectionOptions,
  firstRow: number,
): number {
  let row = firstRow;
  for (const db of dbs) {
    row++;
    const t = fromCloudTags(db.labels ?? {});
    add(batch, row, {
      id: o.key(db.id),
      name: db.name,
      type: "DATABASE",
      environment: t.environment,
      description: [`${o.label} managed ${db.engine ?? "database"}`, db.size, db.region]
        .filter(Boolean)
        .join(" · "),
      hostname: db.hostname,
      version: db.version,
      ips: uniqueIps(db.ips),
      ports: db.port ? [db.port] : undefined,
      tags: [o.tag, "managed-database", ...t.tags],
    });
  }
  return row;
}

/**
 * Load balancers → NETWORK. A backend configured on a load balancer is
 * EXPOSED_THROUGH it: configuration read from the provider, so a fact (not a
 * suggestion). Server backends must be in the same inventory; IP backends
 * resolve against the Library and are skipped when unknown; host-name
 * backends resolve to a resource of the batch with that host name.
 */
function cloudLoadBalancers(
  batch: ImportBatch,
  lbs: readonly CloudLoadBalancer[],
  o: CloudSectionOptions,
  firstRow: number,
): number {
  let row = firstRow;
  for (const lb of lbs) {
    row++;
    const t = fromCloudTags(lb.labels ?? {});
    const self = o.key(lb.id);
    const created = add(batch, row, {
      id: self,
      name: lb.name,
      type: "NETWORK",
      environment: t.environment,
      description: [lb.kind ?? `${o.label} load balancer`, lb.region].filter(Boolean).join(" · "),
      hostname: lb.hostname,
      ips: uniqueIps(lb.ips),
      ports: lb.ports?.length ? [...new Set(lb.ports)].sort((a, b) => a - b) : undefined,
      tags: [o.tag, "load-balancer", ...t.tags],
    });
    if (!created) continue;
    const byHost = new Map<string, string>();
    const byIp = new Map<string, string[]>();
    for (const r of batch.resources) {
      if (r.input.type === "DOMAIN" || r.key === self) continue;
      if (r.input.metadata?.hostname) byHost.set(r.input.metadata.hostname.toLowerCase(), r.key);
      for (const ip of r.input.metadata?.ipAddresses ?? [])
        byIp.set(ip.toLowerCase(), [...(byIp.get(ip.toLowerCase()) ?? []), r.key]);
    }
    const ipRef = (ip: string) => {
      const own = byIp.get(ip.toLowerCase());
      return own?.length === 1 ? own[0]! : `ip:${ip}`;
    };
    const seen = new Set<string>();
    for (const target of lb.targets ?? []) {
      const ref = target.server
        ? (o.serverKey ?? o.key)(target.server)
        : target.lb
          ? o.key(target.lb)
          : target.host
            ? (byHost.get(target.host.toLowerCase()) ?? null)
            : target.ip
              ? ipRef(target.ip)
              : null;
      if (!ref || seen.has(ref) || ref === self) continue;
      seen.add(ref);
      if (target.server && o.serverKeys && !o.serverKeys.has(ref)) continue; // not in this inventory
      batch.relationships.push({
        row,
        from: ref,
        to: self,
        type: "EXPOSED_THROUGH",
        note: `Load balancer backend (${o.label} configuration)`,
        suggested: false,
        optional: !target.server && !target.lb,
      });
    }
  }
  return row;
}

// ───────────────────────── Tailscale (M27) ─────────────────────────

export interface TailnetDevice {
  id: string;
  /** MagicDNS name, e.g. "web-1.tail1234.ts.net". */
  name: string;
  /** The machine's own host name. */
  hostname?: string;
  addresses?: string[];
  os?: string;
  /** ACL tags, e.g. "tag:server". Tagged devices are servers, not people's laptops. */
  tags?: string[];
}

export interface TailnetInput {
  tailnet: string;
  /** Devices that match nothing in the Library: create the tagged ones, all, or none. */
  create: "tagged" | "all" | "none";
  devices: TailnetDevice[];
}

/**
 * Tailnet devices → the machines they are. A device whose name matches a
 * SERVER / VM of the Library only adds its tailnet addresses and a tag to it
 * (enrichment, so traffic over Tailscale resolves to the right machine);
 * unmatched devices are created as SERVER per `create`, otherwise skipped.
 */
function tailscale(batch: ImportBatch, data: unknown) {
  const inv = (data ?? {}) as Partial<TailnetInput>;
  const create = inv.create ?? "tagged";
  let row = 0;
  for (const d of inv.devices ?? []) {
    row++;
    const fqdn = d.name?.replace(/\.$/, "").toLowerCase();
    const name = d.hostname || fqdn?.split(".")[0];
    if (!name) continue;
    const tags = (d.tags ?? []).map((t) => cleanTag(`tailscale:${t.replace(/^tag:/, "")}`));
    const r = add(batch, row, {
      id: `device/${d.id}`,
      name,
      type: "SERVER",
      description: ["Tailscale device", d.os].filter(Boolean).join(" · "),
      os: d.os,
      fqdn,
      ips: [...new Set(d.addresses ?? [])],
      tags: ["tailscale", ...tags],
    });
    if (r)
      r.enrich = { create: create === "all" || (create === "tagged" && (d.tags?.length ?? 0) > 0) };
  }
  if (row === 0) batch.warnings.push(`No devices found in tailnet ${inv.tailnet ?? ""}.`.trim());
}

// ───────────────────────── Storage appliances (M27) ─────────────────────────

const STORAGE_SOURCES = {
  truenas: { label: "TrueNAS", tag: "truenas" },
  synology: { label: "Synology DSM", tag: "synology" },
} as const;

export interface StorageShare {
  id: string;
  name: string;
  protocol: "smb" | "nfs" | "iscsi" | "share";
  path?: string;
  comment?: string;
}

export interface StorageInput {
  source: keyof typeof STORAGE_SOURCES;
  appliance: { name: string; model?: string; version?: string; ips?: string[] };
  shares: StorageShare[];
  /** Machines connected right now (SMB / NFS / iSCSI sessions), by IP; share = StorageShare.id. */
  clients?: { ip: string; share?: string }[];
}

/**
 * A NAS and its shares / iSCSI targets → STORAGE resources, each share drawn
 * inside the appliance (RUNS_ON). Machines connected to a share right now are
 * suggested as STORES_DATA_IN it (a session seen once is evidence, not a
 * confirmed dependency); unknown IPs are skipped with a warning.
 */
function storage(batch: ImportBatch, data: unknown) {
  const inv = (data ?? {}) as Partial<StorageInput>;
  const src = inv.source && STORAGE_SOURCES[inv.source];
  if (!src || !inv.appliance?.name) {
    batch.errors.push({ row: 0, message: "Unknown storage appliance." });
    return;
  }
  const host = inv.appliance.name.toLowerCase();
  const key = (...parts: string[]) => [src.tag, host, ...parts].join("/").toLowerCase();
  let row = 1;
  const appliance = add(batch, row, {
    id: key(),
    name: inv.appliance.name,
    type: "STORAGE",
    description: [src.label, inv.appliance.model].filter(Boolean).join(" · "),
    version: inv.appliance.version,
    ips: inv.appliance.ips,
    tags: [src.tag],
  });
  if (!appliance) return;
  const PROTOCOL = {
    smb: "SMB share",
    nfs: "NFS export",
    iscsi: "iSCSI target",
    share: "Shared folder",
  };
  const shareKeys = new Map<string, string>();
  for (const s of inv.shares ?? []) {
    row++;
    const k = key(s.protocol, s.id);
    const created = add(batch, row, {
      id: k,
      name: `${s.name} (${inv.appliance.name})`,
      type: "STORAGE",
      description: [PROTOCOL[s.protocol] ?? "Share", s.path, s.comment].filter(Boolean).join(" · "),
      tags: [src.tag, ...(s.protocol === "share" ? [] : [s.protocol])],
    });
    if (!created) continue;
    shareKeys.set(s.id, k);
    batch.relationships.push({
      row,
      from: k,
      to: key(),
      type: "RUNS_ON",
      note: `Reported by ${src.label}`,
      suggested: false,
    });
  }
  const seen = new Set<string>();
  for (const c of inv.clients ?? []) {
    const to = (c.share && shareKeys.get(c.share)) || key();
    if (!c.ip || seen.has(`${c.ip}|${to}`)) continue;
    seen.add(`${c.ip}|${to}`);
    batch.relationships.push({
      row: 1,
      from: `ip:${c.ip}`,
      to,
      type: "STORES_DATA_IN",
      note: `Connected when ${src.label} was read`,
      suggested: true,
      optional: true,
    });
  }
}

// ───────────────────────── Hypervisors (M24) ─────────────────────────

const HYPERVISORS = {
  vcenter: { label: "VMware", tag: "vmware", host: "ESXi host" },
  hyperv: { label: "Hyper-V", tag: "hyper-v", host: "Hyper-V host" },
  xenorchestra: { label: "XCP-ng", tag: "xcp-ng", host: "XCP-ng host" },
} as const;

/** What ingestion passes for one agent-side hypervisor collection (ADR-035). */
export interface HypervisorInput {
  source: keyof typeof HYPERVISORS;
  hosts: { id: string; name: string; cluster?: string; status?: string; version?: string }[];
  vms: {
    id: string;
    name: string;
    host?: string;
    status?: string;
    cpus?: number;
    memoryMb?: number;
    os?: string;
    hostname?: string;
    ips?: string[];
    template?: boolean;
  }[];
  /** The agent's own host: Hyper-V guests run on it (`host` absent). */
  self?: { id: string };
}

/**
 * Hosts → SERVER, guests → VM, placement host HOSTS VM (CONFIRMED, origin
 * DETECTED: the hypervisor itself reports it). Templates are skipped. A
 * guest that runs the agent is matched to the agent's host by the planner.
 */
function hypervisor(batch: ImportBatch, data: unknown) {
  const input = (data ?? {}) as Partial<HypervisorInput>;
  const kind = input.source && HYPERVISORS[input.source];
  if (!kind) {
    batch.errors.push({ row: 0, message: "Unknown hypervisor source." });
    return;
  }
  const key = (what: string, id: string) => `${input.source}/${what}/${id.toLowerCase()}`;
  let row = 0;
  const hostKeys = new Set<string>();
  for (const h of input.hosts ?? []) {
    row++;
    const created = add(batch, row, {
      id: key("host", h.id),
      name: h.name,
      type: "SERVER",
      description: [kind.host, h.cluster && `cluster ${h.cluster}`, h.version, h.status]
        .filter(Boolean)
        .join(" · "),
      hostname: h.name,
      tags: [kind.tag],
    });
    if (created) hostKeys.add(key("host", h.id));
  }
  for (const vm of input.vms ?? []) {
    row++;
    if (vm.template) {
      batch.warnings.push(`Skipped template ${vm.name}.`);
      continue;
    }
    const self = key("vm", vm.id);
    const created = add(batch, row, {
      id: self,
      name: vm.name,
      type: "VM",
      description: [
        `${kind.label} VM`,
        vm.cpus && `${vm.cpus} vCPU`,
        vm.memoryMb && `${Math.round((vm.memoryMb / 1024) * 10) / 10} GB RAM`,
        vm.status,
      ]
        .filter(Boolean)
        .join(" · "),
      os: vm.os,
      hostname: vm.hostname,
      ips: [...new Set(vm.ips ?? [])],
      tags: [kind.tag],
    });
    if (!created) continue;
    const from = vm.host
      ? hostKeys.has(key("host", vm.host))
        ? key("host", vm.host)
        : null
      : input.self
        ? `id:${input.self.id}`
        : null;
    if (from)
      batch.relationships.push({
        row,
        from,
        to: self,
        type: "HOSTS",
        note: `Reported by ${kind.label}`,
        suggested: false,
      });
  }
  if (row === 0) batch.warnings.push(`No ${kind.label} hosts or VMs found.`);
}

// ───────────────────────── Kubernetes (M25) ─────────────────────────

/** What ingestion passes for one cluster (agent-side collector). */
export interface KubernetesInput {
  cluster: string;
  nodes: { name: string; ips: string[]; version?: string; os?: string }[];
  workloads: {
    namespace: string;
    name: string;
    kind: "Deployment" | "StatefulSet" | "DaemonSet";
    images: string[];
    replicas?: number;
    ready?: number;
    nodes: string[];
    services: { name: string; type: string; ports: number[]; externalIps?: string[] }[];
    hosts?: string[];
  }[];
}

/**
 * Nodes → SERVER (a node running the agent is the same machine: matched by
 * name), workloads → APPLICATION or DATABASE (from the image), each RUNS_ON
 * the nodes where its pods run now (CONFIRMED: the API says so). Ingress
 * host names → DOMAIN that DEPENDS_ON the workload. LoadBalancer IPs belong
 * to the workload, so connections to them resolve to it.
 */
function kubernetes(batch: ImportBatch, data: unknown) {
  const input = (data ?? {}) as Partial<KubernetesInput>;
  const cluster = input.cluster?.trim();
  if (!cluster) {
    batch.errors.push({ row: 0, message: "Kubernetes inventory without a cluster name." });
    return;
  }
  const c = cluster.toLowerCase();
  const clusterTag = cleanTag(`k8s:${cluster}`);
  let row = 0;
  const nodeKeys = new Map<string, string>();
  for (const n of input.nodes ?? []) {
    row++;
    const key = `${c}/node/${n.name.toLowerCase()}`;
    const r = add(batch, row, {
      id: key,
      name: n.name,
      type: "SERVER",
      description: ["Kubernetes node", `cluster ${cluster}`, n.version].filter(Boolean).join(" · "),
      os: n.os,
      hostname: n.name,
      ips: n.ips,
      tags: ["kubernetes", clusterTag],
    });
    if (r) nodeKeys.set(n.name, key);
  }
  for (const w of input.workloads ?? []) {
    row++;
    const key = `${c}/${w.namespace}/${w.kind}/${w.name}`.toLowerCase();
    const kind = classifyImage(w.images[0] ?? "");
    const ports = [...new Set(w.services.flatMap((s) => s.ports))].sort((a, b) => a - b);
    const r = add(batch, row, {
      id: key,
      name: `${w.namespace}/${w.name}`,
      type: kind.type === "DATABASE" ? "DATABASE" : "APPLICATION",
      description: [
        `Kubernetes ${w.kind} in ${cluster}`,
        w.images.join(", "),
        w.replicas !== undefined && `${w.ready ?? 0}/${w.replicas} ready`,
        w.services.length &&
          `services ${w.services.map((s) => `${s.name} (${s.type})`).join(", ")}`,
      ]
        .filter(Boolean)
        .join(" · "),
      version: w.images[0]?.split("@")[0]!.match(/:([^/:]+)$/)?.[1],
      ips: [...new Set(w.services.flatMap((s) => s.externalIps ?? []))],
      ports,
      fqdn: w.hosts?.[0],
      tags: [
        "kubernetes",
        clusterTag,
        cleanTag(`ns:${w.namespace}`),
        ...(kind.tech ? [kind.tech] : []),
      ],
    });
    if (!r) continue;
    for (const node of new Set(w.nodes)) {
      const nodeKey = nodeKeys.get(node);
      if (nodeKey)
        batch.relationships.push({
          row,
          from: key,
          to: nodeKey,
          type: "RUNS_ON",
          note: "Pods scheduled on this node (Kubernetes API)",
          suggested: false,
        });
    }
    for (const name of [...new Set((w.hosts ?? []).map((h) => h.toLowerCase()))]) {
      const domainKey = `dns/${name}`;
      if (!batch.resources.some((x) => x.key === domainKey))
        add(batch, row, {
          id: domainKey,
          name,
          type: "DOMAIN",
          description: `Kubernetes Ingress in ${cluster}`,
          tags: ["kubernetes", clusterTag],
        });
      batch.relationships.push({
        row,
        from: domainKey,
        to: key,
        type: "DEPENDS_ON",
        note: "Ingress rule (Kubernetes API)",
        suggested: false,
      });
    }
  }
  if (row === 0) batch.warnings.push(`No nodes or workloads found in cluster ${cluster}.`);
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
  /** Addresses read from the API (M27): node IP, LXC interfaces, QEMU guest agent. */
  ips?: string[];
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
      ips: items.find((i) => i.type === "node" && i.node === node)?.ips,
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
      ips: i.ips,
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

/**
 * What the Azure integration sends (M27): VMs plus optional sections. A plain
 * array is `az vm list -d` output (file upload, M8).
 */
export interface AzureDoc {
  virtualMachines?: AzureVm[];
  /** Load Balancers and Application Gateways; server targets are VM ids. */
  loadBalancers?: CloudLoadBalancer[];
  /** Azure SQL databases, PostgreSQL / MySQL flexible servers. */
  databases?: CloudDatabase[];
  dns?: DnsRecord[];
}

function azure(batch: ImportBatch, data: unknown) {
  const doc: AzureDoc = Array.isArray(data)
    ? { virtualMachines: data as AzureVm[] }
    : ((data ?? {}) as AzureDoc);
  const vms = doc.virtualMachines ?? [];
  const vmKeys = new Set<string>();
  vms.forEach((vm, i) => {
    const t = fromCloudTags(vm.tags ?? {});
    const ips = [vm.privateIps, vm.publicIps]
      .filter(Boolean)
      .flatMap((s) => String(s).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    const image = vm.storageProfile?.imageReference;
    const created = add(batch, i + 1, {
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
    if (created) vmKeys.add(created.key);
  });
  let row = vms.length;
  const section = (kind: string) => ({
    label: "Azure",
    tag: "azure",
    key: (id: string) => `${kind}/${id}`.toLowerCase(),
    serverKey: (id: string) => id.toLowerCase(),
    serverKeys: vmKeys,
  });
  row = cloudDatabases(batch, doc.databases ?? [], section("db"), row);
  row = cloudLoadBalancers(batch, doc.loadBalancers ?? [], section("lb"), row);
  if (doc.dns?.length) row += dnsRecords(batch, doc.dns, { tag: "azure", label: "Azure" }, row);
  if (row === 0)
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
    /** ELBv2 load balancers (M27, integration only); targets name instance ids. */
    LoadBalancers?: CloudLoadBalancer[];
    /** Route 53 records (M27, integration only). */
    dns?: DnsRecord[];
  };
  let row = 0;
  const instanceKeys = new Set<string>();
  for (const reservation of doc.Reservations ?? []) {
    for (const inst of reservation.Instances ?? []) {
      row++;
      const tags = Object.fromEntries((inst.Tags ?? []).map((t) => [t.Key, t.Value]));
      const t = fromCloudTags(tags);
      if (inst.State?.Name === "terminated") {
        batch.warnings.push(`Skipped terminated instance ${inst.InstanceId}.`);
        continue;
      }
      const created = add(batch, row, {
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
      if (created) instanceKeys.add(created.key);
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
  row = cloudLoadBalancers(
    batch,
    doc.LoadBalancers ?? [],
    {
      label: "AWS",
      tag: "aws",
      key: (arn) => `elb/${arn}`.toLowerCase(),
      serverKey: (id) => id.toLowerCase(),
      serverKeys: instanceKeys,
    },
    row,
  );
  if (doc.dns?.length) row += dnsRecords(batch, doc.dns, { tag: "aws", label: "Route 53" }, row);
  if (row === 0) batch.errors.push({ row: 0, message: "No EC2 instances or RDS databases found." });
}
