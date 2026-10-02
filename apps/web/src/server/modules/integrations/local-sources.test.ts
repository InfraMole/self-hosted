// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local sources (M27): Proxmox VE API, TrueNAS JSON-RPC and Synology DSM Web
 * API against fixtures shaped like their documented responses, through fake
 * local-network deps (the real ones are safe-fetch.ts, tested separately).
 */
import { describe, expect, it } from "vitest";
import { parseImport } from "@/server/modules/importers/parse";
import { planImport, type ExistingResource } from "@/server/modules/importers/plan";
import { RpcError, type RpcSession, type SafeResponse } from "@/server/safe-fetch";
import { proxmox, synology, truenas } from "./local-sources";
import type { LocalDeps } from "./provider-base";

const res = (status: number, body: unknown): SafeResponse => ({
  status,
  headers: new Headers(),
  text: JSON.stringify(body),
});

function fakeLocal(
  routes: [string | RegExp, (url: string, body?: string) => SafeResponse][],
  rpc?: Record<string, (params: unknown[]) => unknown>,
) {
  const calls: { url: string; pin?: string; body?: string; headers?: Record<string, string> }[] =
    [];
  let closed = false;
  const local: LocalDeps = {
    http: async (url, init) => {
      calls.push({ url, pin: init?.pin, body: init?.body, headers: init?.headers });
      const route = routes.find(([m]) => (typeof m === "string" ? url.startsWith(m) : m.test(url)));
      if (!route) throw new Error(`unexpected ${url}`);
      return route[1](url, init?.body);
    },
    rpc: async (url, pin) => {
      calls.push({ url, pin });
      const session: RpcSession = {
        call: async <T>(method: string, params: unknown[] = []) => {
          calls.push({ url: `rpc:${method}` });
          const handler = rpc?.[method];
          if (!handler) throw new RpcError(`Method ${method} not allowed`);
          return handler(params) as T;
        },
        close: () => {
          closed = true;
        },
      };
      return session;
    },
  };
  return { local, calls, closed: () => closed };
}

const deps = (local: LocalDeps) => ({
  http: async () => {
    throw new Error("local sources never use the public http");
  },
  local,
});

const machine = (name: string, ip: string): ExistingResource => ({
  id: `id-${name}`,
  name,
  type: "SERVER",
  source: "AGENT",
  externalId: null,
  environment: null,
  criticality: null,
  description: null,
  notes: null,
  tags: [],
  metadata: { ipAddresses: [ip] },
});

describe("proxmox", () => {
  const PIN = "AB:".repeat(31) + "AB";
  const config = proxmox.configSchema.parse({ url: "https://pve.lab:8006/", fingerprint: PIN });

  it("reads /cluster/resources with the API token and adds node and guest IPs", async () => {
    const { local, calls } = fakeLocal([
      [
        "https://pve.lab:8006/api2/json/cluster/resources",
        () =>
          res(200, {
            data: [
              { id: "node/pve1", type: "node", node: "pve1", status: "online" },
              {
                id: "qemu/100",
                type: "qemu",
                node: "pve1",
                vmid: 100,
                name: "web",
                status: "running",
              },
              {
                id: "lxc/200",
                type: "lxc",
                node: "pve1",
                vmid: 200,
                name: "dns",
                status: "running",
              },
              {
                id: "qemu/101",
                type: "qemu",
                node: "pve1",
                vmid: 101,
                name: "off",
                status: "stopped",
              },
              { id: "storage/pve1/local", type: "storage", node: "pve1" },
            ],
          }),
      ],
      [
        "https://pve.lab:8006/api2/json/cluster/status",
        () =>
          res(200, {
            data: [{ type: "cluster" }, { type: "node", name: "pve1", ip: "192.168.1.5" }],
          }),
      ],
      [
        /qemu\/100\/agent\/network-get-interfaces/,
        () =>
          res(200, {
            data: {
              result: [
                { name: "lo", "ip-addresses": [{ "ip-address": "127.0.0.1" }] },
                {
                  name: "eth0",
                  "ip-addresses": [{ "ip-address": "192.168.1.20" }, { "ip-address": "fe80::1" }],
                },
              ],
            },
          }),
      ],
      [
        /lxc\/200\/interfaces/,
        () => res(200, { data: [{ name: "eth0", inet: "192.168.1.21/24" }] }),
      ],
    ]);
    const out = await proxmox.fetchExport(
      config,
      { tokenId: "inframole@pve!sync", tokenSecret: "6f1b2c3d-1111-2222-3333-444455556666" },
      deps(local),
    );
    expect(config.url).toBe("https://pve.lab:8006");
    expect(calls.every((c) => c.pin === PIN)).toBe(true);
    expect(calls[0]!.headers?.authorization).toBe(
      "PVEAPIToken=inframole@pve!sync=6f1b2c3d-1111-2222-3333-444455556666",
    );
    const batch = parseImport(out.text, "proxmox");
    expect(batch.errors).toEqual([]);
    // VM ids repeat across clusters: keys are scoped (no cluster entry → the host).
    expect(batch.resources.map((r) => r.key)).toEqual([
      "cluster/pve.lab/node/pve1",
      "cluster/pve.lab/qemu/100",
      "cluster/pve.lab/lxc/200",
      "cluster/pve.lab/qemu/101",
    ]);
    expect(
      batch.resources.map((r) => [r.input.name, r.input.type, r.input.metadata.ipAddresses ?? []]),
    ).toEqual([
      ["pve1", "SERVER", ["192.168.1.5"]],
      ["web", "VM", ["192.168.1.20"]],
      ["dns", "CONTAINER", ["192.168.1.21"]],
      ["off", "VM", []],
    ]);
  });

  it("explains a rejected token and refuses URLs with a path or http", async () => {
    const { local } = fakeLocal([["https://pve.lab:8006/", () => res(401, {})]]);
    await expect(
      proxmox.fetchExport(
        config,
        { tokenId: "inframole@pve!sync", tokenSecret: "6f1b2c3d-1111-2222-3333-444455556666" },
        deps(local),
      ),
    ).rejects.toThrow(/API token was rejected/);
    expect(proxmox.configSchema.safeParse({ url: "http://pve.lab:8006" }).success).toBe(false);
    expect(proxmox.configSchema.safeParse({ url: "https://pve.lab/api2" }).success).toBe(false);
    expect(
      proxmox.configSchema.safeParse({ url: "https://pve.lab", fingerprint: "xyz" }).success,
    ).toBe(false);
  });

  it("needs local network access", async () => {
    await expect(
      proxmox.fetchExport(
        config,
        { tokenId: "a@pve!b", tokenSecret: "6f1b2c3d-1111-2222-3333-444455556666" },
        { http: async () => res(200, {}) },
      ),
    ).rejects.toThrow(/Local network access is not available/);
  });
});

describe("truenas", () => {
  const config = truenas.configSchema.parse({ url: "https://nas.lab" });

  it("logs in over JSON-RPC, lists shares and suggests connected machines", async () => {
    const { local, calls, closed } = fakeLocal([], {
      "auth.login_with_api_key": () => true,
      "system.info": () => ({
        hostname: "nas01",
        version: "TrueNAS-25.04.2",
        system_product: "TrueNAS Mini",
      }),
      "sharing.smb.query": () => [
        { id: 1, name: "finance", path: "/mnt/tank/finance", enabled: true },
      ],
      "sharing.nfs.query": () => [{ id: 2, path: "/mnt/tank/vmstore", enabled: true }],
      "iscsi.target.query": () => [{ id: 3, name: "sqldata", alias: null }],
      "smb.status": (params) =>
        params[0] === "SHARES" ? [{ service: "finance", machine: "192.168.1.30" }] : [],
      "nfs.get_nfs3_clients": () => [],
      "nfs.get_nfs4_clients": () => [{ info: { address: "192.168.1.5:812" } }],
      "iscsi.global.sessions": () => [
        { initiator_addr: "192.168.1.40", target: "iqn.2005-10.org.freenas.ctl:sqldata" },
      ],
    });
    const out = await truenas.fetchExport(
      config,
      { apiKey: "1-abcdefghijklmnopqrstuvwxyz" },
      deps(local),
    );
    expect(calls[0]).toEqual({ url: "wss://nas.lab/api/current", pin: undefined });
    expect(closed()).toBe(true);
    const batch = parseImport(out.text, "storage");
    expect(batch.errors).toEqual([]);
    const plan = planImport(
      batch,
      [
        machine("FILE01", "192.168.1.30"),
        machine("pve1", "192.168.1.5"),
        machine("SQL01", "192.168.1.40"),
      ],
      [],
    );
    expect(plan.resources.map((r) => `${r.type} ${r.name}`)).toEqual([
      "STORAGE nas01",
      "STORAGE finance (nas01)",
      "STORAGE vmstore (nas01)",
      "STORAGE sqldata (nas01)",
    ]);
    expect(plan.resources[0]!.input).toMatchObject({
      description: "TrueNAS · TrueNAS Mini",
      metadata: { version: "TrueNAS-25.04.2" },
    });
    expect(
      plan.relationships.map(
        (r) => `${r.fromLabel} ${r.type} ${r.toLabel}${r.suggested ? " (suggested)" : ""}`,
      ),
    ).toEqual([
      "finance (nas01) RUNS_ON nas01",
      "vmstore (nas01) RUNS_ON nas01",
      "sqldata (nas01) RUNS_ON nas01",
      "FILE01 STORES_DATA_IN finance (nas01) (suggested)",
      "pve1 STORES_DATA_IN vmstore (nas01) (suggested)",
      "SQL01 STORES_DATA_IN sqldata (nas01) (suggested)",
    ]);
  });

  it("a key without some privileges still imports what it can; a rejected key fails", async () => {
    const { local } = fakeLocal([], {
      "auth.login_with_api_key": () => true,
      "sharing.smb.query": () => [{ id: 1, name: "media", path: "/mnt/tank/media" }],
    });
    const out = await truenas.fetchExport(
      config,
      { apiKey: "1-abcdefghijklmnopqrstuvwxyz" },
      deps(local),
    );
    const doc = JSON.parse(out.text);
    expect(doc.appliance.name).toBe("nas.lab");
    expect(doc.shares).toHaveLength(1);

    const { local: refused } = fakeLocal([], { "auth.login_with_api_key": () => false });
    await expect(
      truenas.fetchExport(config, { apiKey: "1-abcdefghijklmnopqrstuvwxyz" }, deps(refused)),
    ).rejects.toThrow(/API key was rejected/);
  });
});

describe("synology", () => {
  const config = synology.configSchema.parse({ url: "https://192.168.1.8:5001" });

  it("logs in with a POST, lists shared folders and logs out", async () => {
    const { local, calls } = fakeLocal([
      [
        "https://192.168.1.8:5001/webapi/entry.cgi",
        (_url, body) => {
          const p = new URLSearchParams(body);
          const api = p.get("api");
          if (api === "SYNO.API.Auth" && p.get("method") === "login")
            return res(200, { success: true, data: { sid: "SID123" } });
          if (api === "SYNO.DSM.Info")
            return res(200, {
              success: true,
              data: { model: "DS923+", version_string: "DSM 7.2.2" },
            });
          if (api === "SYNO.FileStation.List")
            return res(200, {
              success: true,
              data: {
                shares: [
                  {
                    name: "backups",
                    path: "/backups",
                    additional: { real_path: "/volume1/backups" },
                  },
                ],
              },
            });
          if (api === "SYNO.Core.CurrentConnection")
            return res(200, {
              success: true,
              data: {
                items: [
                  { from: "192.168.1.30", type: "SMB" },
                  { from: "192.168.1.99", type: "HTTP/HTTPS" },
                ],
              },
            });
          return res(200, { success: true });
        },
      ],
    ]);
    const out = await synology.fetchExport(
      config,
      { account: "inframole", password: "s3cret!" },
      deps(local),
    );
    // The password only travels in the login body, never in a URL.
    expect(calls.some((c) => c.url.includes("s3cret"))).toBe(false);
    expect(
      calls.slice(1, -1).every((c) => new URLSearchParams(c.body).get("_sid") === "SID123"),
    ).toBe(true);
    expect(new URLSearchParams(calls.at(-1)!.body).get("method")).toBe("logout");
    const plan = planImport(
      parseImport(out.text, "storage"),
      [machine("FILE01", "192.168.1.30")],
      [],
    );
    expect(plan.resources.map((r) => r.name)).toEqual(["192.168.1.8", "backups (192.168.1.8)"]);
    expect(plan.resources[0]!.input.metadata.ipAddresses).toEqual(["192.168.1.8"]);
    expect(plan.relationships.map((r) => `${r.fromLabel} ${r.type} ${r.toLabel}`)).toEqual([
      "backups (192.168.1.8) RUNS_ON 192.168.1.8",
      "FILE01 STORES_DATA_IN 192.168.1.8", // web sessions are not storage
    ]);
  });

  it("explains 2-step verification", async () => {
    const { local } = fakeLocal([
      ["https://192.168.1.8:5001/", () => res(200, { success: false, error: { code: 403 } })],
    ]);
    await expect(
      synology.fetchExport(config, { account: "admin", password: "x" }, deps(local)),
    ).rejects.toThrow(/2-step verification/);
  });
});
