// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cloud API integrations of M23 (ADR-034): Hetzner Cloud, DigitalOcean,
 * Scaleway, OVHcloud, Google Cloud and Clouding. Each one reads its inventory
 * with GET requests only and returns the normalised `cloud` import format
 * (parse-platforms.ts → CloudInventory), so planning, reconciliation and
 * ChangeEvents are the shared importer pipeline.
 *
 * Endpoints are fixed https hosts of each provider (never taken from a
 * response or a credential) and go through `deps.http` (safeFetch). Optional
 * sections (load balancers, managed databases) are skipped when the
 * credential is not allowed to read them (401/403 on that section only).
 */
import { createHash, createSign } from "node:crypto";
import { z } from "zod";
import type {
  CloudDatabase,
  CloudInventory,
  CloudLoadBalancer,
  CloudServer,
} from "@/server/modules/importers/parse-platforms";
import type { SafeResponse } from "@/server/safe-fetch";
import {
  IntegrationError,
  last4,
  type ExportResult,
  type Http,
  type Provider,
} from "./provider-base";

const MAX_PAGES = 50;

/** Error text from the usual API error shapes, bounded. */
function apiMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  const candidates = [
    typeof err === "object" ? err?.message : err,
    b.message,
    b.detail,
    b.title,
    (b.errors as { message?: string }[] | undefined)?.[0]?.message,
  ];
  const msg = candidates.find((c): c is string => typeof c === "string" && c.length > 0);
  return (msg ?? `HTTP ${status}`).slice(0, 200);
}

class ForbiddenSection extends IntegrationError {}

function parseBody(res: SafeResponse, provider: string): unknown {
  try {
    return res.text ? JSON.parse(res.text) : {};
  } catch {
    throw new IntegrationError(`${provider}: unexpected response (HTTP ${res.status}).`);
  }
}

async function getJson<T>(
  http: Http,
  provider: string,
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const res = await http(url, { headers: { accept: "application/json", ...headers } });
  const body = parseBody(res, provider);
  if (res.status === 401)
    throw new IntegrationError(`${provider}: the credential was rejected — check it.`);
  if (res.status === 403)
    throw new ForbiddenSection(`${provider} API: ${apiMessage(body, res.status)}`);
  if (res.status !== 200)
    throw new IntegrationError(`${provider} API: ${apiMessage(body, res.status)}`);
  return body as T;
}

/** Optional sections: a credential without access to them still imports the rest. */
async function optional<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenSection) return [];
    throw error;
  }
}

const out = (inventory: CloudInventory): ExportResult => ({
  format: "cloud",
  text: JSON.stringify(inventory),
});

const labelsFromTags = (tags: unknown): Record<string, string> =>
  Object.fromEntries(
    (Array.isArray(tags) ? tags : [])
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .map((t) => {
        const i = t.indexOf(":");
        return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ""];
      }),
  );

/** Non-empty strings, first occurrence kept. */
const strings = (xs: unknown[]): string[] => [
  ...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0)),
];

const token = z.string().trim().min(20).max(512);
const noConfig = z.object({}).strip();

// ───────────────────────── Hetzner Cloud ─────────────────────────

const HETZNER = "https://api.hetzner.cloud/v1";

interface HzServer {
  id: number;
  name: string;
  status?: string;
  public_net?: { ipv4?: { ip?: string } | null };
  private_net?: { ip?: string }[];
  server_type?: { name?: string };
  datacenter?: { location?: { name?: string } };
  image?: { description?: string; os_flavor?: string; os_version?: string } | null;
  labels?: Record<string, string>;
}

interface HzTarget {
  type: string;
  server?: { id: number };
  ip?: { ip: string };
  targets?: HzTarget[];
}

interface HzLoadBalancer {
  id: number;
  name: string;
  public_net?: { ipv4?: { ip?: string } | null; ipv6?: { ip?: string } | null };
  private_net?: { ip?: string }[];
  location?: { name?: string };
  services?: { listen_port?: number }[];
  targets?: HzTarget[];
  labels?: Record<string, string>;
}

async function hetznerList<T>(http: Http, apiToken: string, path: string, field: string) {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson<Record<string, unknown>>(
      http,
      "Hetzner",
      `${HETZNER}${path}?page=${page}&per_page=50`,
      { authorization: `Bearer ${apiToken}` },
    );
    items.push(...((body[field] as T[]) ?? []));
    const next = (body.meta as { pagination?: { next_page?: number | null } } | undefined)
      ?.pagination?.next_page;
    if (!next) break;
  }
  return items;
}

/** Label-selector targets expand to the servers they currently match. */
function hetznerTargets(targets: HzTarget[] = []): { server?: string; ip?: string }[] {
  return targets.flatMap((t) =>
    t.type === "server" && t.server
      ? [{ server: String(t.server.id) }]
      : t.type === "ip" && t.ip
        ? [{ ip: t.ip.ip }]
        : t.type === "label_selector"
          ? hetznerTargets(t.targets)
          : [],
  );
}

export const hetzner: Provider<z.infer<typeof noConfig>, { apiToken: string }> = {
  configSchema: noConfig,
  secretSchema: z.object({ apiToken: token }),
  hint: (s) => last4(s.apiToken),
  async fetchExport(_config, { apiToken }, { http }) {
    const servers = await hetznerList<HzServer>(http, apiToken, "/servers", "servers");
    const lbs = await optional(() =>
      hetznerList<HzLoadBalancer>(http, apiToken, "/load_balancers", "load_balancers"),
    );
    return out({
      provider: "hetzner",
      servers: servers.map((s): CloudServer => ({
        id: String(s.id),
        name: s.name,
        region: s.datacenter?.location?.name,
        size: s.server_type?.name,
        os:
          s.image?.description ??
          ([s.image?.os_flavor, s.image?.os_version].filter(Boolean).join(" ") || undefined),
        status: s.status,
        // IPv6 is a /64 network on Hetzner servers, not an address: left out.
        ips: strings([s.public_net?.ipv4?.ip, ...(s.private_net ?? []).map((n) => n.ip)]),
        labels: s.labels,
      })),
      loadBalancers: lbs.map((lb): CloudLoadBalancer => ({
        id: String(lb.id),
        name: lb.name,
        region: lb.location?.name,
        ips: strings([
          lb.public_net?.ipv4?.ip,
          lb.public_net?.ipv6?.ip,
          ...(lb.private_net ?? []).map((n) => n.ip),
        ]),
        ports: (lb.services ?? []).map((s) => s.listen_port).filter((p): p is number => !!p),
        targets: hetznerTargets(lb.targets),
        labels: lb.labels,
      })),
    });
  },
};

// ───────────────────────── DigitalOcean ─────────────────────────

const DO = "https://api.digitalocean.com/v2";

interface DoDroplet {
  id: number;
  name: string;
  status?: string;
  size_slug?: string;
  region?: { slug?: string };
  image?: { distribution?: string; name?: string };
  networks?: { v4?: { ip_address: string }[]; v6?: { ip_address: string }[] };
  tags?: string[];
}

interface DoLoadBalancer {
  id: string;
  name: string;
  ip?: string;
  ipv6?: string;
  region?: { slug?: string };
  droplet_ids?: number[];
  forwarding_rules?: { entry_port?: number }[];
}

interface DoDatabase {
  id: string;
  name: string;
  engine?: string;
  version?: string;
  region?: string;
  size?: string;
  connection?: { host?: string; port?: number };
  private_connection?: { host?: string };
  tags?: string[] | null;
}

const DO_ENGINES: Record<string, string> = {
  pg: "PostgreSQL",
  mysql: "MySQL",
  redis: "Redis",
  valkey: "Valkey",
  mongodb: "MongoDB",
  kafka: "Kafka",
  opensearch: "OpenSearch",
};

async function doList<T>(http: Http, apiToken: string, path: string, field: string) {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await getJson<Record<string, unknown>>(
      http,
      "DigitalOcean",
      `${DO}${path}${sep}per_page=200&page=${page}`,
      { authorization: `Bearer ${apiToken}` },
    );
    items.push(...((body[field] as T[]) ?? []));
    const next = (body.links as { pages?: { next?: string } } | undefined)?.pages?.next;
    if (!next) break;
  }
  return items;
}

export const digitalocean: Provider<z.infer<typeof noConfig>, { apiToken: string }> = {
  configSchema: noConfig,
  secretSchema: z.object({ apiToken: token }),
  hint: (s) => last4(s.apiToken),
  async fetchExport(_config, { apiToken }, { http }) {
    const droplets = await doList<DoDroplet>(http, apiToken, "/droplets", "droplets");
    const lbs = await optional(() =>
      doList<DoLoadBalancer>(http, apiToken, "/load_balancers", "load_balancers"),
    );
    const dbs = await optional(() => doList<DoDatabase>(http, apiToken, "/databases", "databases"));
    return out({
      provider: "digitalocean",
      servers: droplets.map((d): CloudServer => ({
        id: String(d.id),
        name: d.name,
        region: d.region?.slug,
        size: d.size_slug,
        os: [d.image?.distribution, d.image?.name].filter(Boolean).join(" ") || undefined,
        status: d.status,
        ips: strings([
          ...(d.networks?.v4 ?? []).map((n) => n.ip_address),
          ...(d.networks?.v6 ?? []).map((n) => n.ip_address),
        ]),
        labels: labelsFromTags(d.tags),
      })),
      loadBalancers: lbs.map((lb): CloudLoadBalancer => ({
        id: lb.id,
        name: lb.name,
        region: lb.region?.slug,
        ips: strings([lb.ip, lb.ipv6]),
        ports: (lb.forwarding_rules ?? []).map((r) => r.entry_port).filter((p): p is number => !!p),
        targets: (lb.droplet_ids ?? []).map((id) => ({ server: String(id) })),
      })),
      databases: dbs.map((db): CloudDatabase => ({
        id: db.id,
        name: db.name,
        engine: DO_ENGINES[db.engine ?? ""] ?? db.engine,
        version: db.version,
        region: db.region,
        size: db.size,
        hostname: db.private_connection?.host ?? db.connection?.host,
        port: db.connection?.port,
        labels: labelsFromTags(db.tags),
      })),
    });
  },
};

// ───────────────────────── Scaleway ─────────────────────────

const SCW = "https://api.scaleway.com";
const splitZones = (s: string) => [
  ...new Set(
    s
      .split(",")
      .map((z) => z.trim().toLowerCase())
      .filter(Boolean),
  ),
];
/** Stored as typed ("fr-par-1, nl-ams-1"): config is re-validated on every sync. */
const zoneList = z
  .string()
  .trim()
  .max(200)
  .refine((s) => {
    const zones = splitZones(s);
    return (
      zones.length >= 1 &&
      zones.length <= 12 &&
      zones.every((z) => /^[a-z]{2}-[a-z]{3}-\d$/.test(z))
    );
  }, "Comma-separated zones, e.g. fr-par-1, nl-ams-1");

interface ScwServer {
  id: string;
  name: string;
  hostname?: string;
  commercial_type?: string;
  state?: string;
  zone?: string;
  public_ip?: { address?: string } | null;
  public_ips?: { address?: string }[];
  private_ip?: string | null;
  image?: { name?: string } | null;
  tags?: string[];
}

interface ScwLb {
  id: string;
  name: string;
  zone?: string;
  ip?: { ip_address?: string }[];
  tags?: string[];
}

interface ScwDb {
  id: string;
  name: string;
  engine?: string;
  region?: string;
  node_type?: string;
  endpoints?: { ip?: string; port?: number; hostname?: string }[];
  tags?: string[];
}

/** Instance API pages with `per_page`; Load Balancer and Database APIs with `page_size`. */
async function scwList<T>(
  http: Http,
  secretKey: string,
  url: string,
  field: string,
  sizeParam: "per_page" | "page_size" = "page_size",
) {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const body = await getJson<Record<string, unknown>>(
      http,
      "Scaleway",
      `${url}${sep}page=${page}&${sizeParam}=100`,
      { "x-auth-token": secretKey },
    );
    const got = (body[field] as T[]) ?? [];
    items.push(...got);
    const total = typeof body.total_count === "number" ? body.total_count : undefined;
    if (got.length < 100 || (total !== undefined && items.length >= total)) break;
  }
  return items;
}

const scwEngine = (engine?: string) => engine?.replace(/-[\d.]+$/, "");
const scwVersion = (engine?: string) => engine?.match(/-([\d.]+)$/)?.[1];

export const scaleway: Provider<{ zones: string }, { secretKey: string }> = {
  configSchema: z.object({ zones: zoneList }),
  secretSchema: z.object({
    secretKey: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a UUID"),
  }),
  hint: (s) => last4(s.secretKey),
  async fetchExport(config, { secretKey }, { http }) {
    const zones = splitZones(config.zones);
    const servers: ScwServer[] = [];
    const lbs: CloudLoadBalancer[] = [];
    const regions = [...new Set(zones.map((z) => z.replace(/-\d$/, "")))];
    for (const zone of zones) {
      servers.push(
        ...(await scwList<ScwServer>(
          http,
          secretKey,
          `${SCW}/instance/v1/zones/${zone}/servers`,
          "servers",
          "per_page",
        )),
      );
      const zoneLbs = await optional(() =>
        scwList<ScwLb>(http, secretKey, `${SCW}/lb/v1/zones/${zone}/lbs`, "lbs"),
      );
      for (const lb of zoneLbs.slice(0, 50)) {
        const base = `${SCW}/lb/v1/zones/${zone}/lbs/${encodeURIComponent(lb.id)}`;
        const [backends, frontends] = await Promise.all([
          optional(() =>
            scwList<{ pool?: string[] }>(http, secretKey, `${base}/backends`, "backends"),
          ),
          optional(() =>
            scwList<{ inbound_port?: number }>(http, secretKey, `${base}/frontends`, "frontends"),
          ),
        ]);
        lbs.push({
          id: lb.id,
          name: lb.name,
          region: lb.zone ?? zone,
          ips: strings((lb.ip ?? []).map((i) => i.ip_address)),
          ports: frontends.map((f) => f.inbound_port).filter((p): p is number => !!p),
          targets: backends.flatMap((b) => (b.pool ?? []).map((ip) => ({ ip }))),
          labels: labelsFromTags(lb.tags),
        });
      }
    }
    const dbs: ScwDb[] = [];
    for (const region of regions) {
      dbs.push(
        ...(await optional(() =>
          scwList<ScwDb>(http, secretKey, `${SCW}/rdb/v1/regions/${region}/instances`, "instances"),
        )),
      );
    }
    return out({
      provider: "scaleway",
      servers: servers.map((s): CloudServer => ({
        id: s.id,
        name: s.name,
        hostname: s.hostname,
        region: s.zone,
        size: s.commercial_type,
        os: s.image?.name,
        status: s.state,
        ips: strings([
          ...(s.public_ips ?? []).map((p) => p.address),
          s.public_ip?.address,
          s.private_ip,
        ]),
        labels: labelsFromTags(s.tags),
      })),
      loadBalancers: lbs,
      databases: dbs.map((db): CloudDatabase => ({
        id: db.id,
        name: db.name,
        engine: scwEngine(db.engine),
        version: scwVersion(db.engine),
        region: db.region,
        size: db.node_type,
        hostname: db.endpoints?.find((e) => e.hostname)?.hostname,
        ips: strings((db.endpoints ?? []).map((e) => e.ip)),
        port: db.endpoints?.[0]?.port,
        labels: labelsFromTags(db.tags),
      })),
    });
  },
};

// ───────────────────────── OVHcloud ─────────────────────────

export const OVH_ENDPOINTS = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
} as const;

const ovhConfig = z.object({
  endpoint: z.enum(["ovh-eu", "ovh-ca", "ovh-us"]).default("ovh-eu"),
  /** Public Cloud project; empty = every project the key can read. */
  projectId: z
    .string()
    .trim()
    .regex(/^([0-9a-f]{32})?$/i, "32 hexadecimal characters")
    .optional(),
});
const ovhSecret = z.object({
  applicationKey: z.string().trim().min(8).max(64),
  applicationSecret: z.string().trim().min(16).max(128),
  consumerKey: z.string().trim().min(16).max(128),
});

interface OvhInstance {
  id: string;
  name: string;
  status?: string;
  region?: string;
  flavorId?: string;
  ipAddresses?: { ip: string; type?: string; version?: number }[];
}

interface OvhDedicated {
  name: string;
  ip?: string;
  reverse?: string;
  os?: string;
  datacenter?: string;
  state?: string;
  commercialRange?: string;
}

/** OVHcloud's request signature: "$1$" + SHA1(AS+CK+METHOD+URL+BODY+TIMESTAMP). */
export function ovhSignature(
  applicationSecret: string,
  consumerKey: string,
  method: string,
  url: string,
  body: string,
  timestamp: number,
): string {
  const payload = [applicationSecret, consumerKey, method, url, body, String(timestamp)].join("+");
  return `$1$${createHash("sha1").update(payload).digest("hex")}`;
}

export const ovhcloud: Provider<z.infer<typeof ovhConfig>, z.infer<typeof ovhSecret>> = {
  configSchema: ovhConfig,
  secretSchema: ovhSecret,
  hint: (s) => last4(s.consumerKey),
  async fetchExport(config, secret, { http }) {
    const base = OVH_ENDPOINTS[config.endpoint];
    const timeRes = await http(`${base}/auth/time`);
    const serverTime = Number(timeRes.text);
    const delta = Number.isFinite(serverTime) ? serverTime - Math.floor(Date.now() / 1000) : 0;
    const get = <T>(path: string) => {
      const url = `${base}${path}`;
      const ts = Math.floor(Date.now() / 1000) + delta;
      return getJson<T>(http, "OVHcloud", url, {
        "x-ovh-application": secret.applicationKey,
        "x-ovh-consumer": secret.consumerKey,
        "x-ovh-timestamp": String(ts),
        "x-ovh-signature": ovhSignature(
          secret.applicationSecret,
          secret.consumerKey,
          "GET",
          url,
          "",
          ts,
        ),
      });
    };

    const projects = config.projectId
      ? [config.projectId]
      : (await optional(() => get<string[]>("/cloud/project"))).slice(0, 20);
    const servers: CloudServer[] = [];
    for (const project of projects) {
      const instances = await get<OvhInstance[]>(
        `/cloud/project/${encodeURIComponent(project)}/instance`,
      );
      for (const i of instances)
        servers.push({
          id: i.id,
          name: i.name,
          region: i.region,
          status: i.status,
          ips: strings((i.ipAddresses ?? []).map((a) => a.ip)),
        });
    }
    const dedicated = (await optional(() => get<string[]>("/dedicated/server"))).slice(0, 200);
    for (const name of dedicated) {
      const d = await get<OvhDedicated>(`/dedicated/server/${encodeURIComponent(name)}`);
      servers.push({
        id: `dedicated/${d.name}`,
        name: d.reverse?.replace(/\.$/, "") || d.name,
        kind: "SERVER",
        hostname: d.name,
        region: d.datacenter,
        size: d.commercialRange,
        os: d.os,
        status: d.state,
        ips: strings([d.ip]),
      });
    }
    return out({ provider: "ovhcloud", servers });
  },
};

// ───────────────────────── Google Cloud ─────────────────────────

const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform.read-only";
const projectId = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "A project ID like my-project-123");

/** The pasted JSON key file, or (when re-validated at sync) the stored object. */
const serviceAccountKey = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.length > 10_000) return v;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  },
  z.object(
    {
      type: z.literal("service_account", "Must be a service account key"),
      project_id: z.string().optional(),
      private_key_id: z.string().optional(),
      private_key: z.string().includes("PRIVATE KEY", "Missing private_key"),
      client_email: z.email("Missing client_email"),
    },
    { error: "Paste the service account key JSON file" },
  ),
);

type GcpKey = z.infer<typeof serviceAccountKey>;

interface GcpInstance {
  id: string;
  name: string;
  status?: string;
  zone?: string;
  machineType?: string;
  networkInterfaces?: { networkIP?: string; accessConfigs?: { natIP?: string }[] }[];
  labels?: Record<string, string>;
  disks?: { boot?: boolean; licenses?: string[] }[];
}

interface GcpSqlInstance {
  name: string;
  databaseVersion?: string;
  region?: string;
  ipAddresses?: { ipAddress?: string; type?: string }[];
  settings?: { tier?: string; userLabels?: Record<string, string> };
}

const lastSegment = (url?: string) => url?.split("/").pop();
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** OAuth 2.0 JWT bearer grant for a service account (RFC 7523). */
export function googleAssertion(key: Pick<GcpKey, "client_email" | "private_key">, now: number) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: GCP_SCOPE,
      aud: GOOGLE_TOKEN,
      iat: now,
      exp: now + 600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(key.private_key).toString("base64url")}`;
}

const gcpConfig = z.object({ projectId: projectId.optional().or(z.literal("")) });

export const googleCloud: Provider<z.infer<typeof gcpConfig>, { serviceAccountKey: GcpKey }> = {
  configSchema: gcpConfig,
  secretSchema: z.object({ serviceAccountKey }) as z.ZodType<{ serviceAccountKey: GcpKey }>,
  hint: (s) => last4(s.serviceAccountKey.private_key_id ?? ""),
  async fetchExport(config, { serviceAccountKey: key }, { http }) {
    const project = config.projectId || key.project_id;
    if (!project || !projectId.safeParse(project).success)
      throw new IntegrationError("Google Cloud: set the project ID.");
    let assertion: string;
    try {
      assertion = googleAssertion(key, Math.floor(Date.now() / 1000));
    } catch {
      throw new IntegrationError("Google Cloud: the service account private key is not valid.");
    }
    const tokenRes = await http(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    const tokenBody = parseBody(tokenRes, "Google Cloud") as { access_token?: unknown };
    if (tokenRes.status !== 200 || typeof tokenBody.access_token !== "string")
      throw new IntegrationError("Google Cloud login failed — check the service account key.");
    const auth = { authorization: `Bearer ${tokenBody.access_token}` };
    const p = encodeURIComponent(project);

    const instances: GcpInstance[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await getJson<{
        items?: Record<string, { instances?: GcpInstance[] }>;
        nextPageToken?: string;
      }>(
        http,
        "Google Cloud",
        `https://compute.googleapis.com/compute/v1/projects/${p}/aggregated/instances?maxResults=500&returnPartialSuccess=true${
          pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
        }`,
        auth,
      );
      for (const scope of Object.values(body.items ?? {}))
        instances.push(...(scope.instances ?? []));
      if (!(pageToken = body.nextPageToken)) break;
    }

    // Cloud SQL is optional: the API may be disabled on the project.
    const sql = await optional(async () => {
      const items: GcpSqlInstance[] = [];
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await getJson<{ items?: GcpSqlInstance[]; nextPageToken?: string }>(
          http,
          "Google Cloud",
          `https://sqladmin.googleapis.com/v1/projects/${p}/instances${
            token ? `?pageToken=${encodeURIComponent(token)}` : ""
          }`,
          auth,
        );
        items.push(...(body.items ?? []));
        if (!(token = body.nextPageToken)) break;
      }
      return items;
    });

    return out({
      provider: "gcp",
      servers: instances.map((i): CloudServer => ({
        id: i.id,
        name: i.name,
        region: lastSegment(i.zone),
        size: lastSegment(i.machineType),
        os: lastSegment(i.disks?.find((d) => d.boot)?.licenses?.[0]),
        status: i.status,
        ips: strings(
          (i.networkInterfaces ?? []).flatMap((n) => [
            n.networkIP,
            ...(n.accessConfigs ?? []).map((a) => a.natIP),
          ]),
        ),
        labels: i.labels,
      })),
      databases: sql.map((db): CloudDatabase => {
        const [engine, ...version] = (db.databaseVersion ?? "").split("_");
        return {
          id: db.name,
          name: db.name,
          engine: engine ? `Cloud SQL ${engine[0]}${engine.slice(1).toLowerCase()}` : "Cloud SQL",
          version: version.join(".") || undefined,
          region: db.region,
          size: db.settings?.tier,
          ips: strings((db.ipAddresses ?? []).map((a) => a.ipAddress)),
          labels: db.settings?.userLabels,
        };
      }),
    });
  },
};

// ───────────────────────── Clouding ─────────────────────────

const CLOUDING = "https://api.clouding.io/v1";

interface CloudingServer {
  id: string;
  name: string;
  hostname?: string;
  vCores?: number;
  ramGb?: number;
  flavor?: string;
  image?: { name?: string } | null;
  status?: string;
  powerState?: string;
  publicIp?: string | null;
  privateIp?: string | null;
  publicPorts?: { ipAddress?: string }[];
  vpcPorts?: { ipAddress?: string }[];
}

export const clouding: Provider<z.infer<typeof noConfig>, { apiKey: string }> = {
  configSchema: noConfig,
  secretSchema: z.object({ apiKey: token }),
  hint: (s) => last4(s.apiKey),
  async fetchExport(_config, { apiKey }, { http }) {
    const servers: CloudingServer[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await getJson<{ servers?: CloudingServer[]; links?: { next?: string | null } }>(
        http,
        "Clouding",
        `${CLOUDING}/servers?page=${page}&pageSize=200`,
        { "x-api-key": apiKey },
      );
      servers.push(...(body.servers ?? []));
      if (!body.links?.next) break;
    }
    return out({
      provider: "clouding",
      servers: servers.map((s): CloudServer => ({
        id: s.id,
        name: s.name,
        hostname: s.hostname,
        size:
          s.vCores && s.ramGb ? `${s.vCores} vCores / ${s.ramGb} GB RAM` : (s.flavor ?? undefined),
        os: s.image?.name,
        status: s.powerState ?? s.status,
        ips: strings([
          s.publicIp,
          s.privateIp,
          ...(s.publicPorts ?? []).map((p) => p.ipAddress),
          ...(s.vpcPorts ?? []).map((p) => p.ipAddress),
        ]),
      })),
    });
  },
};
