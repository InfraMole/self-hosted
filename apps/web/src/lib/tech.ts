// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a resource is and where it runs, from its tags (set by the agent,
 * collectors and integrations) and OS. Shown as text monograms in our own
 * colours — never third-party logos: product names are used only to
 * identify the technology (docs/DECISIONS.md, ADR-037). Client-safe, pure.
 */

export type TechCategory = "database" | "web" | "app" | "platform" | "cloud" | "os";

export interface Tech {
  /** Full product name (tooltip, accessible label). */
  label: string;
  /** 2–3 characters shown in the chip. */
  mono: string;
  category: TechCategory;
}

export const TECHS = {
  // Databases and data stores
  postgresql: { label: "PostgreSQL", mono: "PG", category: "database" },
  mysql: { label: "MySQL", mono: "My", category: "database" },
  mariadb: { label: "MariaDB", mono: "Ma", category: "database" },
  "sql-server": { label: "SQL Server", mono: "SQL", category: "database" },
  mongodb: { label: "MongoDB", mono: "Mg", category: "database" },
  redis: { label: "Redis", mono: "Rd", category: "database" },
  elasticsearch: { label: "Elasticsearch", mono: "ES", category: "database" },
  opensearch: { label: "OpenSearch", mono: "OS", category: "database" },
  influxdb: { label: "InfluxDB", mono: "Ix", category: "database" },
  clickhouse: { label: "ClickHouse", mono: "CH", category: "database" },
  cassandra: { label: "Cassandra", mono: "Ca", category: "database" },
  // Web servers and reverse proxies
  nginx: { label: "nginx", mono: "NGX", category: "web" },
  apache: { label: "Apache httpd", mono: "AP", category: "web" },
  iis: { label: "IIS", mono: "IIS", category: "web" },
  haproxy: { label: "HAProxy", mono: "HA", category: "web" },
  traefik: { label: "Traefik", mono: "TRF", category: "web" },
  caddy: { label: "Caddy", mono: "CDY", category: "web" },
  // Other software
  rabbitmq: { label: "RabbitMQ", mono: "MQ", category: "app" },
  kafka: { label: "Kafka", mono: "KFK", category: "app" },
  // Where it runs
  docker: { label: "Docker", mono: "DKR", category: "platform" },
  kubernetes: { label: "Kubernetes", mono: "K8s", category: "platform" },
  vmware: { label: "VMware", mono: "VMW", category: "platform" },
  "hyper-v": { label: "Hyper-V", mono: "HV", category: "platform" },
  "xcp-ng": { label: "XCP-ng", mono: "XCP", category: "platform" },
  proxmox: { label: "Proxmox VE", mono: "PVE", category: "platform" },
  // Clouds
  aws: { label: "AWS", mono: "AWS", category: "cloud" },
  azure: { label: "Azure", mono: "AZ", category: "cloud" },
  gcp: { label: "Google Cloud", mono: "GCP", category: "cloud" },
  hetzner: { label: "Hetzner Cloud", mono: "HZ", category: "cloud" },
  digitalocean: { label: "DigitalOcean", mono: "DO", category: "cloud" },
  scaleway: { label: "Scaleway", mono: "SCW", category: "cloud" },
  ovhcloud: { label: "OVHcloud", mono: "OVH", category: "cloud" },
  clouding: { label: "Clouding", mono: "CLD", category: "cloud" },
  cloudflare: { label: "Cloudflare", mono: "CF", category: "cloud" },
  // Operating systems (servers without anything more specific)
  windows: { label: "Windows", mono: "WIN", category: "os" },
  linux: { label: "Linux", mono: "LNX", category: "os" },
} as const satisfies Record<string, Tech>;

export type TechKey = keyof typeof TECHS;

/** Tag spellings seen in the wild → our key. */
const ALIASES: Record<string, TechKey> = {
  postgres: "postgresql",
  mssql: "sql-server",
  sqlserver: "sql-server",
  mongo: "mongodb",
  valkey: "redis",
  httpd: "apache",
  k8s: "kubernetes",
  hyperv: "hyper-v",
  xcpng: "xcp-ng",
  "google-cloud": "gcp",
  ovh: "ovhcloud",
};

const isTech = (s: string): s is TechKey => Object.hasOwn(TECHS, s);

/** OS strings ("Ubuntu 24.04", "Windows Server 2022", "Proxmox VE 8") → key. */
function osTech(os: string | null | undefined): TechKey | undefined {
  if (!os) return undefined;
  const o = os.toLowerCase();
  if (o.includes("proxmox")) return "proxmox";
  if (o.includes("windows")) return "windows";
  if (/(linux|ubuntu|debian|red hat|rhel|rocky|alma|centos|suse|fedora|alpine|k3s)/.test(o))
    return "linux";
  return undefined;
}

export interface ResourceTech {
  /** What it is (PostgreSQL, nginx…) — or the platform / OS when that is all we know. */
  primary?: TechKey;
  /** Where it runs (Docker, Kubernetes, VMware, a cloud…), when different from primary. */
  platform?: TechKey;
}

/**
 * The most specific "what" from the tags (databases, then web, then other
 * software), and the "where" (platform, then cloud). Without a "what", the
 * platform or the OS becomes the primary.
 */
export function resolveTech(
  tags: readonly string[] | null | undefined,
  os?: string | null,
): ResourceTech {
  const keys: TechKey[] = [];
  for (const raw of tags ?? []) {
    const t = raw.toLowerCase();
    const key = isTech(t) ? t : ALIASES[t];
    if (key && !keys.includes(key)) keys.push(key);
  }
  const first = (...cats: TechCategory[]) =>
    cats.map((c) => keys.find((k) => TECHS[k].category === c)).find(Boolean);
  const what = first("database", "web", "app");
  const where = first("platform", "cloud");
  if (what) return where ? { primary: what, platform: where } : { primary: what };
  if (where) return { primary: where };
  const system = first("os") ?? osTech(os);
  return system ? { primary: system } : {};
}
