// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Other tools' inventories (M31, ADR-045): NetBox, Zabbix and PRTG read
 * through their APIs into the normalised `inventory` import format. They
 * follow the local-source pattern (ADR-042): https only, an optional pinned
 * certificate, private networks only when INTEGRATIONS_PRIVATE_NETWORKS
 * allows them (a public NetBox Cloud works anywhere). Read-only calls.
 */
import { z } from "zod";
import type { RelationshipType } from "@depmap/graph";
import type { InventoryInput, InventoryItem } from "@/server/modules/importers/parse-platforms";
import { apiMessage, parseBody } from "./cloud-providers";
import { localOf, usableIps } from "./local-sources";
import { IntegrationError, last4, strings, type LocalDeps, type Provider } from "./provider-base";

/**
 * https://host[:port][/path] — these tools often live under a path
 * (/zabbix, /netbox). No query, fragment or credentials.
 */
const toolUrl = z
  .string()
  .trim()
  .url("A URL like https://netbox.example.lan")
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
  }, "https:// with a host, an optional port and path")
  .transform((v) => {
    const u = new URL(v);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  });

const fingerprint = z
  .string()
  .trim()
  .regex(/^(([0-9a-f]{2}:?){31}[0-9a-f]{2})?$/i, "64 hexadecimal characters (SHA-256)")
  .optional();

export const toolConfig = z.object({ url: toolUrl, fingerprint });
type ToolConfig = z.infer<typeof toolConfig>;

const token = z.string().trim().min(8).max(512);

/** Cap per object list: a sync stays within the import limits. */
export const TOOL_LIMITS = { objects: 5000, page: 1000 } as const;

const NETWORK_GEAR =
  /switch|router|firewall|gateway|access[ -]?point|\bap\b|wlan|wi-?fi|load[ -]?balancer|\bspine\b|\bleaf\b|modem|patch[ -]?panel|\bfw\b|\bcore\b/i;
const STORAGE_GEAR = /storage|\bnas\b|\bsan\b|disk ?array/i;

/** PRODUCTION / STAGING / … from tag-like words; only values the importer accepts. */
export function environmentOf(words: readonly (string | undefined)[]): string | undefined {
  for (const w of words) {
    const v = w?.toLowerCase().replace(/^(env|environment|stage)[:=]/, "");
    if (!v) continue;
    if (/^(prod|production|prd)$/.test(v)) return "PRODUCTION";
    if (/^(staging|stage|stg|preprod)$/.test(v)) return "STAGING";
    if (/^(development|dev)$/.test(v)) return "DEVELOPMENT";
    if (/^(test|testing|qa)$/.test(v)) return "TEST";
  }
  return undefined;
}

const tag = (key: string, value: string | undefined | null) =>
  value ? `${key}:${value}` : undefined;

async function getJson<T>(
  local: LocalDeps,
  config: ToolConfig,
  label: string,
  path: string,
  headers: Record<string, string>,
): Promise<T> {
  const res = await local.http(`${config.url}${path}`, {
    headers: { accept: "application/json", ...headers },
    pin: config.fingerprint,
  });
  if (res.status === 401 || res.status === 403)
    throw new IntegrationError(`${label}: the API token was rejected or lacks read access.`);
  const body = parseBody(res, label);
  if (res.status !== 200)
    throw new IntegrationError(`${label} API: ${apiMessage(body, res.status)}`);
  return body as T;
}

// ───────────────────────── NetBox ─────────────────────────

type Ref = { id: number; name?: string | null; slug?: string; display?: string } | null;
interface NbIp {
  address: string;
}
interface NbObject {
  id: number;
  name: string | null;
  status?: { value?: string } | null;
  role?: Ref;
  device_role?: Ref; // NetBox < 4.0
  device_type?: { model?: string; manufacturer?: Ref } | null;
  platform?: Ref;
  site?: Ref;
  tenant?: Ref;
  cluster?: Ref;
  device?: Ref; // a VM pinned to a host
  primary_ip4?: NbIp | null;
  primary_ip6?: NbIp | null;
  tags?: { slug?: string; name?: string }[];
  description?: string;
}
interface NbIpAddress {
  address: string;
  assigned_object_type?: string | null;
  assigned_object?: { device?: Ref; virtual_machine?: Ref } | null;
}
interface NbTermination {
  object_type?: string;
  object?: { device?: Ref } | null;
}
interface NbCable {
  id: number;
  a_terminations?: NbTermination[];
  b_terminations?: NbTermination[];
}

/** Statuses that are not (yet / any more) running infrastructure. */
const NB_SKIP = new Set(["planned", "decommissioning", "inventory"]);

const netboxSecret = z.object({ token });

export const netbox: Provider<ToolConfig, z.infer<typeof netboxSecret>> = {
  configSchema: toolConfig,
  secretSchema: netboxSecret,
  hint: (s) => last4(s.token),
  async fetchExport(config, secret, deps) {
    const local = localOf(deps);
    // v2 tokens (NetBox 4.5+) are "nbt_…" bearer tokens; older ones use "Token".
    const authorization = secret.token.startsWith("nbt_")
      ? `Bearer ${secret.token}`
      : `Token ${secret.token}`;
    const list = async <T>(path: string, optional = false): Promise<T[]> => {
      const out: T[] = [];
      for (let offset = 0; out.length < TOOL_LIMITS.objects; offset += TOOL_LIMITS.page) {
        let page: { results?: T[]; next?: string | null };
        try {
          page = await getJson(
            local,
            config,
            "NetBox",
            `/api/${path}/?limit=${TOOL_LIMITS.page}&offset=${offset}`,
            {
              authorization,
            },
          );
        } catch (error) {
          if (optional && error instanceof IntegrationError && !/rejected/.test(error.message))
            return out;
          throw error;
        }
        out.push(...(page.results ?? []));
        if (!page.next || !page.results?.length) break;
      }
      return out.slice(0, TOOL_LIMITS.objects);
    };
    const devices = await list<NbObject>("dcim/devices");
    const vms = await list<NbObject>("virtualization/virtual-machines");
    const ips = await list<NbIpAddress>("ipam/ip-addresses", true);
    const cables = await list<NbCable>("dcim/cables", true);
    return {
      format: "inventory",
      text: JSON.stringify(netboxInventory({ devices, vms, ips, cables })),
    };
  },
};

/** NetBox objects → inventory (pure; tested with recorded API responses). */
export function netboxInventory(input: {
  devices: NbObject[];
  vms: NbObject[];
  ips: NbIpAddress[];
  cables: NbCable[];
}): InventoryInput {
  const addresses = new Map<string, string[]>();
  for (const ip of input.ips) {
    const owner = ip.assigned_object?.device
      ? `device/${ip.assigned_object.device.id}`
      : ip.assigned_object?.virtual_machine
        ? `vm/${ip.assigned_object.virtual_machine.id}`
        : null;
    if (owner) addresses.set(owner, [...(addresses.get(owner) ?? []), ip.address]);
  }
  const items: InventoryItem[] = [];
  const kinds = new Map<string, string>();
  const describe = (o: NbObject, kind: "device" | "vm") => {
    const role = o.role ?? o.device_role;
    const model = [o.device_type?.manufacturer?.name, o.device_type?.model]
      .filter(Boolean)
      .join(" ");
    const id = `${kind}/${o.id}`;
    const words = `${role?.name ?? ""} ${role?.slug ?? ""} ${model}`;
    const type =
      kind === "vm"
        ? "VM"
        : NETWORK_GEAR.test(words)
          ? "NETWORK"
          : STORAGE_GEAR.test(words)
            ? "STORAGE"
            : "SERVER";
    kinds.set(id, type);
    const tagSlugs = (o.tags ?? []).map((t) => t.slug ?? t.name ?? "").filter(Boolean);
    items.push({
      id,
      name: o.name!,
      type,
      description: [
        kind === "vm" ? "NetBox virtual machine" : role?.name,
        model,
        o.site?.name,
        o.description,
      ]
        .filter(Boolean)
        .join(" · "),
      environment: environmentOf(tagSlugs),
      os: o.platform?.name ?? undefined,
      ips: usableIps([
        o.primary_ip4?.address,
        o.primary_ip6?.address,
        ...(addresses.get(id) ?? []),
      ]),
      tags: strings([
        tag("site", o.site?.slug),
        tag("tenant", o.tenant?.slug),
        tag("cluster", o.cluster?.name),
        tag("role", role?.slug),
        ...tagSlugs,
      ]),
    });
  };
  for (const d of input.devices)
    if (d.name && !NB_SKIP.has(d.status?.value ?? "")) describe(d, "device");
  for (const v of input.vms) if (v.name && !NB_SKIP.has(v.status?.value ?? "")) describe(v, "vm");

  const links: InventoryInput["links"] = [];
  for (const v of input.vms)
    if (v.device && kinds.has(`device/${v.device.id}`) && kinds.has(`vm/${v.id}`))
      links.push({
        from: `device/${v.device.id}`,
        to: `vm/${v.id}`,
        type: "HOSTS",
        note: "VM placement (NetBox)",
      });
  // A cable between a machine and network gear: the machine depends on it.
  const seen = new Set<string>();
  for (const c of input.cables) {
    const end = (ts?: NbTermination[]) => {
      const id = ts?.find((t) => t.object?.device)?.object?.device?.id;
      return id === undefined ? null : `device/${id}`;
    };
    const a = end(c.a_terminations);
    const b = end(c.b_terminations);
    if (!a || !b || a === b || !kinds.has(a) || !kinds.has(b)) continue;
    const aNet = kinds.get(a) === "NETWORK";
    const bNet = kinds.get(b) === "NETWORK";
    if (aNet === bNet) continue; // switch ↔ switch or server ↔ server: no direction to claim
    const [machine, gear] = aNet ? [b, a] : [a, b];
    if (seen.has(`${machine}|${gear}`)) continue;
    seen.add(`${machine}|${gear}`);
    links.push({ from: machine, to: gear, type: "DEPENDS_ON", note: "Cable (NetBox)" });
  }
  return { source: "netbox", items, links };
}

// ───────────────────────── Zabbix ─────────────────────────

interface ZbxHost {
  hostid: string;
  host: string;
  name?: string;
  description?: string;
  interfaces?: { ip?: string; dns?: string; type?: string; main?: string }[];
  hostgroups?: { name: string }[];
  groups?: { name: string }[]; // Zabbix < 6.2
  inventory?:
    | {
        os?: string;
        os_short?: string;
        type?: string;
        poc_1_name?: string;
        poc_1_email?: string;
      }
    | [];
  tags?: { tag: string; value?: string }[];
}
interface ZbxTrigger {
  triggerid: string;
  hosts?: { hostid: string }[];
  dependencies?: { triggerid: string }[];
}

const zabbixSecret = z.object({ token });

/** "7.0.3" → [7, 0]. */
const majorMinor = (v: string) => v.split(".").map(Number).slice(0, 2) as [number, number];

export const zabbix: Provider<ToolConfig, z.infer<typeof zabbixSecret>> = {
  configSchema: toolConfig,
  secretSchema: zabbixSecret,
  hint: (s) => last4(s.token),
  async fetchExport(config, secret, deps) {
    const local = localOf(deps);
    const endpoint = config.url.endsWith("api_jsonrpc.php")
      ? config.url
      : `${config.url}/api_jsonrpc.php`;
    let id = 0;
    let bearer = true;
    const call = async <T>(method: string, params: unknown, auth = true): Promise<T> => {
      const body: Record<string, unknown> = { jsonrpc: "2.0", method, params, id: ++id };
      // Zabbix 6.4+ reads the token from the header; older versions from "auth".
      if (auth && !bearer) body.auth = secret.token;
      const res = await local.http(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json-rpc",
          ...(auth && bearer ? { authorization: `Bearer ${secret.token}` } : {}),
        },
        body: JSON.stringify(body),
        pin: config.fingerprint,
      });
      const out = parseBody(res, "Zabbix") as {
        result?: T;
        error?: { message?: string; data?: string };
      };
      if (out.error) {
        const detail = `${out.error.message ?? ""} ${out.error.data ?? ""}`.trim();
        if (/not authori[sz]ed|session terminated|invalid.*token|re-login/i.test(detail))
          throw new IntegrationError("Zabbix: the API token was rejected or has expired.");
        throw new IntegrationError(`Zabbix API: ${detail.slice(0, 200)}`);
      }
      if (res.status !== 200 || out.result === undefined)
        throw new IntegrationError(`Zabbix API: HTTP ${res.status}`);
      return out.result;
    };
    const version = await call<string>("apiinfo.version", [], false);
    const [major, minor] = majorMinor(version);
    bearer = major > 6 || (major === 6 && minor >= 4);
    const groupsKey =
      major > 6 || (major === 6 && minor >= 2) ? "selectHostGroups" : "selectGroups";
    const hosts = await call<ZbxHost[]>("host.get", {
      output: ["hostid", "host", "name", "description"],
      filter: { status: "0" }, // monitored hosts only
      selectInterfaces: ["ip", "dns", "type", "main"],
      [groupsKey]: ["name"],
      selectInventory: ["os", "os_short", "type", "poc_1_name", "poc_1_email"],
      selectTags: ["tag", "value"],
      limit: TOOL_LIMITS.objects,
    });
    let triggers: ZbxTrigger[] = [];
    let dependencyHosts = new Map<string, string[]>();
    if (hosts.length) {
      triggers = (
        await call<ZbxTrigger[]>("trigger.get", {
          output: ["triggerid"],
          hostids: hosts.map((h) => h.hostid),
          selectHosts: ["hostid"],
          selectDependencies: ["triggerid"],
          limit: 50_000,
        })
      ).filter((t) => t.dependencies?.length);
      const depIds = [...new Set(triggers.flatMap((t) => t.dependencies!.map((d) => d.triggerid)))];
      if (depIds.length) {
        const deps = await call<ZbxTrigger[]>("trigger.get", {
          output: ["triggerid"],
          triggerids: depIds,
          selectHosts: ["hostid"],
        });
        dependencyHosts = new Map(
          deps.map((d) => [d.triggerid, (d.hosts ?? []).map((h) => h.hostid)]),
        );
      }
    }
    return {
      format: "inventory",
      text: JSON.stringify(zabbixInventory(hosts, triggers, dependencyHosts)),
    };
  },
};

/** Zabbix hosts and trigger dependencies → inventory (pure). */
export function zabbixInventory(
  hosts: ZbxHost[],
  triggers: ZbxTrigger[],
  dependencyHosts: Map<string, string[]>,
): InventoryInput {
  const items: InventoryItem[] = hosts.map((h) => {
    const groups = (h.hostgroups ?? h.groups ?? []).map((g) => g.name);
    const inv = Array.isArray(h.inventory) ? {} : (h.inventory ?? {});
    const ifaces = h.interfaces ?? [];
    const agentLike = ifaces.some((i) => i.type !== "2");
    const words = `${groups.join(" ")} ${inv.type ?? ""}`;
    const type = /virtual machine|\bvms?\b/i.test(words)
      ? "VM"
      : NETWORK_GEAR.test(words) || (ifaces.length > 0 && !agentLike)
        ? "NETWORK"
        : STORAGE_GEAR.test(words)
          ? "STORAGE"
          : "SERVER";
    const main = ifaces.find((i) => i.main === "1" && i.type !== "2") ?? ifaces[0];
    const tags = (h.tags ?? []).map((t) => (t.value ? `${t.tag}:${t.value}` : t.tag));
    return {
      id: `host/${h.hostid}`,
      name: h.name || h.host,
      type,
      description: ["Zabbix host", inv.type, h.description].filter(Boolean).join(" · "),
      environment: environmentOf(tags),
      hostname: main?.dns || h.host,
      os: inv.os_short || inv.os || undefined,
      ips: usableIps(ifaces.map((i) => (i.ip && i.ip !== "0.0.0.0" ? i.ip : undefined))),
      owner: inv.poc_1_name || undefined,
      ownerContact: inv.poc_1_email || undefined,
      tags: strings([...groups.map((g) => `group:${g}`), ...tags]),
    };
  });
  const known = new Set(hosts.map((h) => h.hostid));
  const seen = new Set<string>();
  const links: InventoryInput["links"] = [];
  for (const t of triggers)
    for (const from of (t.hosts ?? []).map((h) => h.hostid))
      for (const d of t.dependencies ?? [])
        for (const to of dependencyHosts.get(d.triggerid) ?? []) {
          if (from === to || !known.has(from) || !known.has(to) || seen.has(`${from}|${to}`))
            continue;
          seen.add(`${from}|${to}`);
          links.push({
            from: `host/${from}`,
            to: `host/${to}`,
            type: "DEPENDS_ON" satisfies RelationshipType,
            note: "Trigger dependency (Zabbix)",
            declared: true,
          });
        }
  return { source: "zabbix", items, links };
}

// ───────────────────────── PRTG ─────────────────────────

interface PrtgDevice {
  objid: number;
  device: string;
  host?: string;
  group?: string;
  probe?: string;
  tags?: string;
}

const prtgSecret = z.object({ apiToken: token });

export const prtg: Provider<ToolConfig, z.infer<typeof prtgSecret>> = {
  configSchema: toolConfig,
  secretSchema: prtgSecret,
  hint: (s) => last4(s.apiToken),
  async fetchExport(config, secret, deps) {
    const local = localOf(deps);
    // PRTG's API v1 takes the token as a query parameter (its documented form).
    const query = new URLSearchParams({
      content: "devices",
      columns: "objid,device,host,group,probe,tags",
      count: String(TOOL_LIMITS.objects),
      apitoken: secret.apiToken,
    });
    const body = await getJson<{ devices?: PrtgDevice[] }>(
      local,
      config,
      "PRTG",
      `/api/table.json?${query.toString()}`,
      {},
    );
    return { format: "inventory", text: JSON.stringify(prtgInventory(body.devices ?? [])) };
  },
};

/** PRTG devices → inventory (pure). */
export function prtgInventory(devices: PrtgDevice[]): InventoryInput {
  const ip = /^[\d.]+$|:/;
  return {
    source: "prtg",
    items: devices
      .filter((d) => d.device)
      .map((d) => {
        const tags = (d.tags ?? "").split(/\s+/).filter(Boolean);
        const host = d.host?.trim();
        const words = `${d.device} ${tags.join(" ")} ${d.group ?? ""}`;
        return {
          id: `device/${d.objid}`,
          name: d.device,
          type: NETWORK_GEAR.test(words)
            ? "NETWORK"
            : STORAGE_GEAR.test(words)
              ? "STORAGE"
              : "SERVER",
          description: ["PRTG device", d.group].filter(Boolean).join(" · "),
          environment: environmentOf(tags),
          ...(host && ip.test(host)
            ? { ips: usableIps([host]) }
            : host?.includes(".")
              ? { fqdn: host, hostname: host.split(".")[0] }
              : { hostname: host || undefined }),
          tags: strings([tag("group", d.group), tag("probe", d.probe), ...tags]),
        };
      }),
    links: [],
  };
}
