// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cloud API integrations of M27 (ADR-042): Vultr, Akamai Cloud (Linode),
 * IONOS Cloud and Oracle Cloud Infrastructure. Same contract as M23
 * (cloud-providers.ts): GET requests only to fixed https hosts of each
 * provider, through `deps.http` (safeFetch), returning the normalised `cloud`
 * import format. Optional sections are skipped when the credential cannot
 * read them.
 */
import { createSign } from "node:crypto";
import { z } from "zod";
import type {
  CloudDatabase,
  CloudLoadBalancer,
  CloudServer,
} from "@/server/modules/importers/parse-platforms";
import {
  MAX_PAGES,
  ForbiddenSection,
  apiMessage,
  getJson,
  labelsFromTags,
  optional,
  out,
  parseBody,
  token,
} from "./cloud-providers";
import {
  IntegrationError,
  last4,
  mapLimit,
  strings,
  type Http,
  type Provider,
} from "./provider-base";

const noConfig = z.object({}).strip();

// ───────────────────────── Vultr ─────────────────────────

const VULTR = "https://api.vultr.com/v2";

interface VultrInstance {
  id: string;
  label?: string;
  hostname?: string;
  os?: string;
  region?: string;
  plan?: string;
  main_ip?: string;
  v6_main_ip?: string;
  internal_ip?: string;
  power_status?: string;
  tags?: string[];
}

interface VultrLb {
  id: string;
  label?: string;
  region?: string;
  ipv4?: string;
  ipv6?: string;
  instances?: string[];
  forwarding_rules?: { frontend_port?: number }[];
}

interface VultrDb {
  id: string;
  label?: string;
  database_engine?: string;
  database_engine_version?: string;
  region?: string;
  plan?: string;
  host?: string;
  port?: string | number;
  tag?: string;
}

const VULTR_ENGINES: Record<string, string> = {
  pg: "PostgreSQL",
  mysql: "MySQL",
  redis: "Redis",
  valkey: "Valkey",
  kafka: "Kafka",
};

/** "0.0.0.0" / "::" mean "no address" in Vultr responses. */
const realIp = (ip?: string) => (ip && ip !== "0.0.0.0" && ip !== "::" ? ip : undefined);

async function vultrList<T>(http: Http, apiKey: string, path: string, field: string) {
  const items: T[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson<Record<string, unknown>>(
      http,
      "Vultr",
      `${VULTR}${path}?per_page=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { authorization: `Bearer ${apiKey}` },
    );
    items.push(...((body[field] as T[]) ?? []));
    cursor = (body.meta as { links?: { next?: string } } | undefined)?.links?.next ?? "";
    if (!cursor) break;
  }
  return items;
}

export const vultr: Provider<z.infer<typeof noConfig>, { apiKey: string }> = {
  configSchema: noConfig,
  secretSchema: z.object({ apiKey: z.string().trim().min(20).max(128) }),
  hint: (s) => last4(s.apiKey),
  async fetchExport(_config, { apiKey }, { http }) {
    const instances = await vultrList<VultrInstance>(http, apiKey, "/instances", "instances");
    const lbs = await optional(() =>
      vultrList<VultrLb>(http, apiKey, "/load-balancers", "load_balancers"),
    );
    const dbs = await optional(() => vultrList<VultrDb>(http, apiKey, "/databases", "databases"));
    return out({
      provider: "vultr",
      servers: instances.map((i): CloudServer => ({
        id: i.id,
        name: i.label || i.hostname || i.id,
        hostname: i.hostname,
        region: i.region,
        size: i.plan,
        os: i.os,
        status: i.power_status,
        ips: strings([realIp(i.main_ip), realIp(i.v6_main_ip), realIp(i.internal_ip)]),
        labels: labelsFromTags(i.tags),
      })),
      loadBalancers: lbs.map((lb): CloudLoadBalancer => ({
        id: lb.id,
        name: lb.label || lb.id,
        region: lb.region,
        ips: strings([realIp(lb.ipv4), realIp(lb.ipv6)]),
        ports: (lb.forwarding_rules ?? [])
          .map((r) => r.frontend_port)
          .filter((p): p is number => !!p),
        targets: (lb.instances ?? []).map((id) => ({ server: id })),
      })),
      databases: dbs.map((db): CloudDatabase => ({
        id: db.id,
        name: db.label || db.id,
        engine: VULTR_ENGINES[db.database_engine ?? ""] ?? db.database_engine,
        version: db.database_engine_version,
        region: db.region,
        size: db.plan,
        hostname: db.host,
        port: db.port ? Number(db.port) : undefined,
        labels: labelsFromTags(db.tag ? [db.tag] : []),
      })),
    });
  },
};

// ───────────────────────── Akamai Cloud (Linode) ─────────────────────────

const LINODE = "https://api.linode.com/v4";

interface LinodeInstance {
  id: number;
  label: string;
  region?: string;
  type?: string;
  image?: string | null;
  status?: string;
  ipv4?: string[];
  ipv6?: string | null;
  tags?: string[];
}

interface LinodeNodeBalancer {
  id: number;
  label: string;
  region?: string;
  hostname?: string;
  ipv4?: string;
  ipv6?: string | null;
  tags?: string[];
}

interface LinodeDb {
  id: number;
  label: string;
  engine?: string;
  version?: string;
  region?: string;
  type?: string;
  port?: number;
  hosts?: { primary?: string };
}

async function linodeList<T>(http: Http, apiToken: string, path: string) {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await getJson<{ data?: T[]; pages?: number }>(
      http,
      "Linode",
      `${LINODE}${path}?page=${page}&page_size=500`,
      { authorization: `Bearer ${apiToken}` },
    );
    items.push(...(body.data ?? []));
    if (page >= (body.pages ?? 1)) break;
  }
  return items;
}

export const linode: Provider<z.infer<typeof noConfig>, { apiToken: string }> = {
  configSchema: noConfig,
  secretSchema: z.object({ apiToken: token }),
  hint: (s) => last4(s.apiToken),
  async fetchExport(_config, { apiToken }, { http }) {
    const instances = await linodeList<LinodeInstance>(http, apiToken, "/linode/instances");
    const balancers = await optional(() =>
      linodeList<LinodeNodeBalancer>(http, apiToken, "/nodebalancers"),
    );
    const loadBalancers = await mapLimit(
      balancers.slice(0, 100),
      4,
      async (nb): Promise<CloudLoadBalancer> => {
        const configs = await optional(() =>
          linodeList<{ id: number; port?: number }>(
            http,
            apiToken,
            `/nodebalancers/${nb.id}/configs`,
          ),
        );
        const nodes = (
          await mapLimit(configs, 4, (c) =>
            optional(() =>
              linodeList<{ address?: string }>(
                http,
                apiToken,
                `/nodebalancers/${nb.id}/configs/${c.id}/nodes`,
              ),
            ),
          )
        ).flat();
        return {
          id: String(nb.id),
          name: nb.label,
          kind: "Linode NodeBalancer",
          region: nb.region,
          hostname: nb.hostname,
          ips: strings([nb.ipv4, nb.ipv6]),
          ports: configs.map((c) => c.port).filter((p): p is number => !!p),
          // "192.168.210.120:80" → the backend's (private) IP.
          targets: nodes.map((n) => ({ ip: n.address?.replace(/:\d+$/, "") })),
          labels: labelsFromTags(nb.tags),
        };
      },
    );
    const dbs = await optional(() => linodeList<LinodeDb>(http, apiToken, "/databases/instances"));
    return out({
      provider: "linode",
      servers: instances.map((i): CloudServer => ({
        id: String(i.id),
        name: i.label,
        region: i.region,
        size: i.type,
        os: i.image ?? undefined,
        status: i.status,
        ips: strings([...(i.ipv4 ?? []), i.ipv6?.replace(/\/128$/, "")]),
        labels: labelsFromTags(i.tags),
      })),
      loadBalancers,
      databases: dbs.map((db): CloudDatabase => ({
        id: String(db.id),
        name: db.label,
        engine:
          db.engine === "postgresql" ? "PostgreSQL" : db.engine === "mysql" ? "MySQL" : db.engine,
        version: db.version,
        region: db.region,
        size: db.type,
        hostname: db.hosts?.primary,
        port: db.port,
      })),
    });
  },
};

// ───────────────────────── IONOS Cloud ─────────────────────────

const IONOS = "https://api.ionos.com/cloudapi/v6";

interface IonosServer {
  id: string;
  properties?: { name?: string; cores?: number; ram?: number; vmState?: string; type?: string };
  entities?: { nics?: { items?: { properties?: { ips?: string[] } }[] } };
}

export const ionos: Provider<z.infer<typeof noConfig>, { apiToken: string }> = {
  configSchema: noConfig,
  secretSchema: z.object({ apiToken: token.max(4096) }),
  hint: (s) => last4(s.apiToken),
  async fetchExport(_config, { apiToken }, { http }) {
    const auth = { authorization: `Bearer ${apiToken}` };
    const dcs = await getJson<{ items?: { id: string; properties?: { location?: string } }[] }>(
      http,
      "IONOS",
      `${IONOS}/datacenters?depth=1&limit=1000`,
      auth,
    );
    const servers: CloudServer[] = [];
    for (const dc of (dcs.items ?? []).slice(0, 100)) {
      const body = await getJson<{ items?: IonosServer[] }>(
        http,
        "IONOS",
        `${IONOS}/datacenters/${encodeURIComponent(dc.id)}/servers?depth=3&limit=1000`,
        auth,
      );
      for (const s of body.items ?? []) {
        const p = s.properties ?? {};
        servers.push({
          id: s.id,
          name: p.name || s.id,
          region: dc.properties?.location,
          size:
            p.cores && p.ram ? `${p.cores} vCores / ${Math.round(p.ram / 1024)} GB RAM` : p.type,
          status: p.vmState,
          ips: strings((s.entities?.nics?.items ?? []).flatMap((n) => n.properties?.ips ?? [])),
        });
      }
    }
    return out({ provider: "ionos", servers });
  },
};

// ───────────────────────── Oracle Cloud Infrastructure ─────────────────────────

const ocid = (kind: string) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^ocid1\\.${kind}\\.oc\\d+\\.[a-z0-9-]*\\.[a-z0-9]{20,}$`, "i"),
      `An ${kind} OCID (ocid1.${kind}.oc1..…)`,
    );

const ociConfig = z.object({
  tenancy: ocid("tenancy"),
  user: ocid("user"),
  fingerprint: z
    .string()
    .trim()
    .regex(/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/i, "The API key fingerprint (aa:bb:…)"),
  region: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}-[a-z]+-\d$/, "e.g. eu-frankfurt-1"),
  /** One compartment; empty = the whole tenancy (every accessible compartment). */
  compartment: ocid("compartment").optional().or(z.literal("")),
});
const ociSecret = z.object({
  privateKey: z
    .string()
    .trim()
    .includes("PRIVATE KEY", "Paste the API signing key (PEM)")
    .max(10_000),
});

/**
 * OCI request signature (draft-cavage HTTP signatures, as the OCI SDKs do for
 * GET). `x-date` replaces `date`, which fetch implementations may not let us set.
 */
export function ociAuthorization(
  key: { tenancy: string; user: string; fingerprint: string; privateKey: string },
  url: URL,
  date: string,
): string {
  const signing = [
    `x-date: ${date}`,
    `(request-target): get ${url.pathname}${url.search}`,
    `host: ${url.host}`,
  ].join("\n");
  const signature = createSign("RSA-SHA256").update(signing).sign(key.privateKey, "base64");
  return [
    'Signature version="1"',
    `keyId="${key.tenancy}/${key.user}/${key.fingerprint}"`,
    'algorithm="rsa-sha256"',
    'headers="x-date (request-target) host"',
    `signature="${signature}"`,
  ].join(",");
}

interface OciInstance {
  id: string;
  displayName?: string;
  shape?: string;
  lifecycleState?: string;
  region?: string;
  freeformTags?: Record<string, string>;
}

interface OciLb {
  id: string;
  displayName?: string;
  ipAddresses?: { ipAddress?: string }[];
  listeners?: Record<string, { port?: number }>;
  backendSets?: Record<string, { backends?: { ipAddress?: string }[] }>;
  freeformTags?: Record<string, string>;
}

export const oracleCloud: Provider<z.infer<typeof ociConfig>, z.infer<typeof ociSecret>> = {
  configSchema: ociConfig,
  secretSchema: ociSecret,
  hint: (s) => last4(s.privateKey.replace(/-----[A-Z ]+-----|\s/g, "")),
  async fetchExport(config, { privateKey }, { http }) {
    const key = { ...config, privateKey };
    /** Signed GET of every page (opc-next-page). */
    const list = async <T>(host: string, path: string, params: Record<string, string>) => {
      const items: T[] = [];
      let page: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const url = new URL(`https://${host}.${config.region}.oraclecloud.com${path}`);
        for (const [k, v] of Object.entries({
          ...params,
          limit: "1000",
          ...(page ? { page } : {}),
        }))
          url.searchParams.set(k, v);
        let authorization: string;
        const date = new Date().toUTCString();
        try {
          authorization = ociAuthorization(key, url, date);
        } catch {
          throw new IntegrationError("Oracle Cloud: the API signing key is not valid.");
        }
        const res = await http(url.toString(), {
          headers: { accept: "application/json", "x-date": date, authorization },
        });
        const body = parseBody(res, "Oracle Cloud");
        if (res.status === 401)
          throw new IntegrationError(
            "Oracle Cloud: the request was not authorised — check the OCIDs, fingerprint and key.",
          );
        if (res.status === 403 || res.status === 404)
          throw new ForbiddenSection(`Oracle Cloud API: ${apiMessage(body, res.status)}`);
        if (res.status !== 200)
          throw new IntegrationError(`Oracle Cloud API: ${apiMessage(body, res.status)}`);
        items.push(...((Array.isArray(body) ? body : []) as T[]));
        page = res.headers.get("opc-next-page") ?? undefined;
        if (!page) break;
      }
      return items;
    };

    const compartments = config.compartment
      ? [config.compartment]
      : [
          config.tenancy,
          ...(
            await optional(() =>
              list<{ id: string; lifecycleState?: string }>("identity", "/20160918/compartments", {
                compartmentId: config.tenancy,
                compartmentIdInSubtree: "true",
                accessLevel: "ACCESSIBLE",
                lifecycleState: "ACTIVE",
              }),
            )
          ).map((c) => c.id),
        ].slice(0, 100);

    const servers: CloudServer[] = [];
    const loadBalancers: CloudLoadBalancer[] = [];
    for (const compartmentId of compartments) {
      const instances = (
        await optional(() => list<OciInstance>("iaas", "/20160918/instances", { compartmentId }))
      ).filter((i) => i.lifecycleState !== "TERMINATED" && i.lifecycleState !== "TERMINATING");
      const attachments = instances.length
        ? await optional(() =>
            list<{ instanceId: string; vnicId?: string; lifecycleState?: string }>(
              "iaas",
              "/20160918/vnicAttachments",
              { compartmentId },
            ),
          )
        : [];
      const attached = attachments.filter((a) => a.vnicId && a.lifecycleState === "ATTACHED");
      const vnics = await mapLimit(attached.slice(0, 2000), 8, async (a) => {
        const url = new URL(
          `https://iaas.${config.region}.oraclecloud.com/20160918/vnics/${encodeURIComponent(a.vnicId!)}`,
        );
        const date = new Date().toUTCString();
        const res = await http(url.toString(), {
          headers: {
            accept: "application/json",
            "x-date": date,
            authorization: ociAuthorization(key, url, date),
          },
        });
        if (res.status !== 200) return { instanceId: a.instanceId, ips: [] as string[] };
        const v = parseBody(res, "Oracle Cloud") as {
          privateIp?: string;
          publicIp?: string;
          hostnameLabel?: string;
        };
        return {
          instanceId: a.instanceId,
          ips: strings([v.privateIp, v.publicIp]),
          hostname: v.hostnameLabel,
        };
      });
      for (const i of instances) {
        const own = vnics.filter((v) => v.instanceId === i.id);
        servers.push({
          id: i.id,
          name: i.displayName || i.id,
          hostname: own.find((v) => v.hostname)?.hostname,
          region: i.region,
          size: i.shape,
          status: i.lifecycleState,
          ips: strings(own.flatMap((v) => v.ips)),
          labels: i.freeformTags,
        });
      }
      const lbs = await optional(() =>
        list<OciLb>("iaas", "/20170115/loadBalancers", { compartmentId }),
      );
      for (const lb of lbs)
        loadBalancers.push({
          id: lb.id,
          name: lb.displayName || lb.id,
          kind: "OCI load balancer",
          region: config.region,
          ips: strings((lb.ipAddresses ?? []).map((a) => a.ipAddress)),
          ports: Object.values(lb.listeners ?? {})
            .map((l) => l.port)
            .filter((p): p is number => !!p),
          targets: Object.values(lb.backendSets ?? {}).flatMap((set) =>
            (set.backends ?? []).map((b) => ({ ip: b.ipAddress })),
          ),
          labels: lb.freeformTags,
        });
    }
    if (servers.length === 0 && loadBalancers.length === 0 && compartments.length > 0) {
      // Every section refused looks like a policy problem, not an empty tenancy.
      const probe = await list<OciInstance>("iaas", "/20160918/instances", {
        compartmentId: compartments[0]!,
      }).catch((e: unknown) => e);
      if (probe instanceof ForbiddenSection)
        throw new IntegrationError(
          "Oracle Cloud: not allowed to list instances — check the IAM policy (read instance-family, virtual-network-family, load-balancers).",
        );
    }
    return out({ provider: "oci", servers, loadBalancers });
  },
};
