// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local sources (M27, ADR-042): Proxmox VE, TrueNAS and Synology DSM read
 * through their APIs, from the server, without an agent. They usually live on
 * a private network: reaching it needs INTEGRATIONS_PRIVATE_NETWORKS
 * (self-hosted only), and a self-signed certificate is accepted only when its
 * SHA-256 fingerprint is pinned (deps.local, safe-fetch.ts). Read-only calls.
 */
import { z } from "zod";
import type { StorageInput, StorageShare } from "@/server/modules/importers/parse-platforms";
import { RpcError } from "@/server/safe-fetch";
import { apiMessage, parseBody } from "./cloud-providers";
import {
  IntegrationError,
  last4,
  mapLimit,
  strings,
  uuid,
  type LocalDeps,
  type Provider,
  type ProviderDeps,
} from "./provider-base";

/** https://host[:port] — no path, no credentials. Stored as the origin. */
const baseUrl = z
  .string()
  .trim()
  .url("A URL like https://pve.example.lan:8006")
  .refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === "https:" && !u.username && !u.password && (u.pathname === "/" || !u.pathname)
    );
  }, "https:// with a host and optional port only")
  .transform((v) => new URL(v).origin);

/** SHA-256 certificate fingerprint, with or without colons; empty = trust a CA. */
const fingerprint = z
  .string()
  .trim()
  .regex(/^(([0-9a-f]{2}:?){31}[0-9a-f]{2})?$/i, "64 hexadecimal characters (SHA-256)")
  .optional();

const localConfig = z.object({ url: baseUrl, fingerprint });

function localOf(deps: ProviderDeps): LocalDeps {
  if (!deps.local) throw new IntegrationError("Local network access is not available here.");
  return deps.local;
}

/** Addresses worth keeping: no loopback / link-local, no prefix length. */
const usableIps = (ips: (string | undefined)[]) =>
  strings(
    ips
      .map((ip) => ip?.replace(/\/\d+$/, ""))
      .filter((ip) => ip && !/^(127\.|169\.254\.|::1$|fe80:)/i.test(ip)),
  );

/** The host part of the URL when it is an IP address. */
const hostIp = (url: string) => {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return /^[\d.]+$/.test(host) || host.includes(":") ? [host] : [];
};

// ───────────────────────── Proxmox VE ─────────────────────────

const proxmoxSecret = z.object({
  /** "user@realm!tokenname" */
  tokenId: z
    .string()
    .trim()
    .regex(/^[^\s@!]+@[^\s@!]+![A-Za-z0-9._-]+$/, "Like inframole@pve!sync"),
  tokenSecret: uuid,
});

interface PveItem {
  id: string;
  type: string;
  node?: string;
  vmid?: number;
  status?: string;
  template?: number;
  ips?: string[];
}

export const proxmox: Provider<z.infer<typeof localConfig>, z.infer<typeof proxmoxSecret>> = {
  configSchema: localConfig,
  secretSchema: proxmoxSecret,
  hint: (s) => last4(s.tokenSecret),
  async fetchExport(config, secret, deps) {
    const local = localOf(deps);
    const get = async <T>(path: string, optional = false): Promise<T | undefined> => {
      const res = await local.http(`${config.url}/api2/json${path}`, {
        headers: {
          accept: "application/json",
          authorization: `PVEAPIToken=${secret.tokenId}=${secret.tokenSecret}`,
        },
        pin: config.fingerprint,
      });
      if (res.status === 401)
        throw new IntegrationError(
          "Proxmox: the API token was rejected — check its ID and secret.",
        );
      const body = parseBody(res, "Proxmox") as { data?: T };
      if (res.status !== 200) {
        if (optional) return undefined;
        throw new IntegrationError(`Proxmox API: ${apiMessage(body, res.status)}`);
      }
      return body.data;
    };
    // Same document as `pvesh get /cluster/resources --output-format json` (M8).
    const items = ((await get<PveItem[]>("/cluster/resources")) ?? []).filter((i) =>
      ["node", "qemu", "lxc"].includes(i.type),
    );
    const status =
      (await get<{ type: string; name?: string; ip?: string }[]>("/cluster/status", true)) ?? [];
    for (const n of status)
      if (n.type === "node" && n.ip) {
        const item = items.find((i) => i.type === "node" && i.node === n.name);
        if (item) item.ips = usableIps([n.ip]);
      }
    // Guest addresses: LXC interfaces (VM.Audit), QEMU through the guest agent
    // (needs the agent in the VM and its audit privilege); skipped when refused.
    const guests = items
      .filter((i) => (i.type === "qemu" || i.type === "lxc") && i.status === "running" && i.node)
      .slice(0, 500);
    await mapLimit(guests, 6, async (g) => {
      const base = `/nodes/${encodeURIComponent(g.node!)}/${g.type}/${g.vmid}`;
      if (g.type === "lxc") {
        const ifaces =
          (await get<{ inet?: string; inet6?: string }[]>(`${base}/interfaces`, true)) ?? [];
        g.ips = usableIps(ifaces.flatMap((i) => [i.inet, i.inet6]));
      } else {
        const out = await get<{
          result?: { "ip-addresses"?: { "ip-address"?: string }[] }[];
        }>(`${base}/agent/network-get-interfaces`, true);
        g.ips = usableIps(
          (out?.result ?? []).flatMap((i) => (i["ip-addresses"] ?? []).map((a) => a["ip-address"])),
        );
      }
    });
    return { format: "proxmox", text: JSON.stringify(items) };
  },
};

// ───────────────────────── TrueNAS ─────────────────────────

const truenasSecret = z.object({ apiKey: z.string().trim().min(16).max(256) });

/** "iqn.2005-10.org.freenas.ctl:target1" → "target1". */
const targetName = (iqn?: string) => iqn?.split(":").pop()?.toLowerCase();

export const truenas: Provider<z.infer<typeof localConfig>, z.infer<typeof truenasSecret>> = {
  configSchema: localConfig,
  secretSchema: truenasSecret,
  hint: (s) => last4(s.apiKey),
  async fetchExport(config, secret, deps) {
    const local = localOf(deps);
    const url = `${config.url.replace(/^https:/, "wss:")}/api/current`;
    let session;
    try {
      session = await local.rpc(url, config.fingerprint);
    } catch (error) {
      if (error instanceof RpcError)
        throw new IntegrationError(
          `TrueNAS: ${error.message} (the JSON-RPC API needs TrueNAS 25.04 or later).`,
        );
      throw error;
    }
    try {
      const ok = await session.call<boolean>("auth.login_with_api_key", [secret.apiKey]);
      if (ok === false) throw new IntegrationError("TrueNAS: the API key was rejected.");
      /** Optional calls: a role without that privilege leaves the section empty. */
      const maybe = async <T>(method: string, params: unknown[] = []): Promise<T | undefined> => {
        try {
          return await session.call<T>(method, params);
        } catch (error) {
          if (error instanceof RpcError) return undefined;
          throw error;
        }
      };
      const info =
        (await maybe<{ hostname?: string; version?: string; system_product?: string }>(
          "system.info",
        )) ?? {};
      const [smb, nfs, targets, smbStatus, nfs3, nfs4, iscsi] = await Promise.all([
        maybe<{ id: number; name: string; path?: string; comment?: string; enabled?: boolean }[]>(
          "sharing.smb.query",
        ),
        maybe<{ id: number; path?: string; comment?: string; enabled?: boolean }[]>(
          "sharing.nfs.query",
        ),
        maybe<{ id: number; name: string; alias?: string | null }[]>("iscsi.target.query"),
        maybe<{ service?: string; machine?: string }[]>("smb.status", ["SHARES"]),
        maybe<unknown[]>("nfs.get_nfs3_clients"),
        maybe<{ info?: { address?: string } }[]>("nfs.get_nfs4_clients"),
        maybe<{ initiator_addr?: string; target?: string }[]>("iscsi.global.sessions"),
      ]);
      const shares: StorageShare[] = [
        ...(smb ?? [])
          .filter((s) => s.enabled !== false)
          .map((s) => ({
            id: `smb-${s.id}`,
            name: s.name,
            protocol: "smb" as const,
            path: s.path,
            comment: s.comment || undefined,
          })),
        ...(nfs ?? [])
          .filter((s) => s.enabled !== false && s.path)
          .map((s) => ({
            id: `nfs-${s.id}`,
            name: s.path!.split("/").filter(Boolean).pop() ?? s.path!,
            protocol: "nfs" as const,
            path: s.path,
            comment: s.comment || undefined,
          })),
        ...(targets ?? []).map((t) => ({
          id: `iscsi-${t.id}`,
          name: t.alias || t.name,
          protocol: "iscsi" as const,
        })),
      ];
      const smbByName = new Map((smb ?? []).map((s) => [s.name.toLowerCase(), `smb-${s.id}`]));
      const nfsByPath = new Map((nfs ?? []).map((s) => [s.path ?? "", `nfs-${s.id}`]));
      const iscsiByName = new Map(
        (targets ?? []).map((t) => [t.name.toLowerCase(), `iscsi-${t.id}`]),
      );
      const onlyNfs = nfs?.length === 1 ? `nfs-${nfs[0]!.id}` : undefined;
      const ip = (address?: string) =>
        address?.replace(/^\[|\](:\d+)?$/g, "").replace(/^([\d.]+):\d+$/, "$1");
      const clients = [
        ...(smbStatus ?? []).map((s) => ({
          ip: ip(s.machine) ?? "",
          share: smbByName.get((s.service ?? "").toLowerCase()),
        })),
        // NFSv3: "ip" + "export" objects, or "ip:/export" strings depending on the version.
        ...(nfs3 ?? []).map((c) => {
          const o =
            typeof c === "string"
              ? { ip: c.split(":")[0], export: c.slice(c.indexOf(":") + 1) }
              : (c as { ip?: string; export?: string });
          return { ip: ip(o.ip) ?? "", share: nfsByPath.get(o.export ?? "") ?? onlyNfs };
        }),
        ...(nfs4 ?? []).map((c) => ({ ip: ip(c.info?.address) ?? "", share: onlyNfs })),
        ...(iscsi ?? []).map((s) => ({
          ip: ip(s.initiator_addr) ?? "",
          share: iscsiByName.get(targetName(s.target) ?? ""),
        })),
      ].filter((c) => c.ip);
      const doc: StorageInput = {
        source: "truenas",
        appliance: {
          name: info.hostname || new URL(config.url).hostname,
          model: info.system_product,
          version: info.version,
          ips: hostIp(config.url),
        },
        shares,
        clients,
      };
      return { format: "storage", text: JSON.stringify(doc) };
    } finally {
      session.close();
    }
  },
};

// ───────────────────────── Synology DSM ─────────────────────────

const synologySecret = z.object({
  account: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
});

/** DSM error codes worth explaining (SYNO.API.Auth). */
const DSM_LOGIN_ERRORS: Record<number, string> = {
  400: "wrong account or password",
  401: "the account is disabled",
  402: "permission denied",
  403: "the account uses 2-step verification — use a dedicated account without it",
  404: "the account uses 2-step verification — use a dedicated account without it",
  406: "2-step verification is enforced — use a dedicated account exempt from it",
  407: "this IP address is blocked by DSM",
};

export const synology: Provider<z.infer<typeof localConfig>, z.infer<typeof synologySecret>> = {
  configSchema: localConfig,
  secretSchema: synologySecret,
  hint: () => "",
  async fetchExport(config, secret, deps) {
    const local = localOf(deps);
    const entry = `${config.url}/webapi/entry.cgi`;
    type Dsm<T> = { success?: boolean; data?: T; error?: { code?: number } };
    // Credentials go in a POST body, never in a URL.
    const login = await local.http(entry, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api: "SYNO.API.Auth",
        version: "6",
        method: "login",
        account: secret.account,
        passwd: secret.password,
        session: "InfraMole",
        format: "sid",
      }).toString(),
      pin: config.fingerprint,
    });
    const auth = parseBody(login, "Synology") as Dsm<{ sid?: string }>;
    if (!auth.success || !auth.data?.sid) {
      const code = auth.error?.code ?? login.status;
      throw new IntegrationError(
        `Synology login failed: ${DSM_LOGIN_ERRORS[code] ?? `error ${code}`}.`,
      );
    }
    const sid = auth.data.sid;
    const call = async <T>(
      api: string,
      version: number,
      method: string,
      extra: Record<string, string> = {},
    ) => {
      const res = await local.http(entry, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          api,
          version: String(version),
          method,
          _sid: sid,
          ...extra,
        }).toString(),
        pin: config.fingerprint,
      });
      const body = parseBody(res, "Synology") as Dsm<T>;
      return body.success ? body.data : undefined; // permission errors leave the section empty
    };
    try {
      const info = await call<{ model?: string; version_string?: string }>(
        "SYNO.DSM.Info",
        2,
        "getinfo",
      );
      const list = await call<{
        shares?: { name: string; path?: string; additional?: { real_path?: string } }[];
      }>("SYNO.FileStation.List", 2, "list_share", { additional: '["real_path"]', limit: "1000" });
      // Current connections: an administrator account only; who is connected, not to which share.
      const connections = await call<{ items?: { from?: string; type?: string }[] }>(
        "SYNO.Core.CurrentConnection",
        1,
        "get",
      );
      const doc: StorageInput = {
        source: "synology",
        appliance: {
          name: new URL(config.url).hostname,
          model: info?.model,
          version: info?.version_string,
          ips: hostIp(config.url),
        },
        shares: (list?.shares ?? []).map((s) => ({
          id: `share-${s.name}`,
          name: s.name,
          protocol: "share" as const,
          path: s.additional?.real_path ?? s.path,
        })),
        clients: (connections?.items ?? [])
          .filter((c) => c.from && /^(SMB|CIFS|AFP|NFS|iSCSI)/i.test(c.type ?? ""))
          .map((c) => ({ ip: c.from! })),
      };
      return { format: "storage", text: JSON.stringify(doc) };
    } finally {
      await call("SYNO.API.Auth", 6, "logout", { session: "InfraMole" }).catch(() => undefined);
    }
  },
};
