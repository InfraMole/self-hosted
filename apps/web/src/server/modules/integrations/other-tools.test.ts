// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parsePlatform } from "@/server/modules/importers/parse-platforms";
import netboxFixture from "./fixtures/netbox-4.7.json";
import zabbixFixture from "./fixtures/zabbix-7.0.json";
import {
  environmentOf,
  netbox,
  netboxInventory,
  prtg,
  prtgInventory,
  toolConfig,
  zabbix,
  zabbixInventory,
} from "./other-tools";
import type { ProviderDeps } from "./provider-base";

type Call = { url: string; headers: Record<string, string>; body?: string };

/** A fake local network: answers by URL, records what was sent. */
function fakeLocal(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const deps: ProviderDeps = {
    http: async () => {
      throw new Error("public http not expected");
    },
    local: {
      http: async (url, init = {}) => {
        const call = { url, headers: init.headers ?? {}, body: init.body };
        calls.push(call);
        const { status = 200, body } = answer(call);
        return { status, headers: new Headers(), text: JSON.stringify(body) };
      },
      rpc: async () => {
        throw new Error("rpc not expected");
      },
    },
  };
  return { deps, calls };
}

const batchOf = (doc: unknown) => parsePlatform("inventory", doc);

describe("tool URLs", () => {
  it("accept a path (Zabbix under /zabbix) and refuse http, queries and credentials", () => {
    expect(toolConfig.parse({ url: "https://zbx.lan/zabbix/" }).url).toBe("https://zbx.lan/zabbix");
    expect(toolConfig.parse({ url: "https://netbox.lan" }).url).toBe("https://netbox.lan");
    for (const url of ["http://netbox.lan", "https://a:b@netbox.lan", "https://netbox.lan/?x=1"])
      expect(toolConfig.safeParse({ url }).success).toBe(false);
  });

  it("reads environments only from words the importer accepts", () => {
    expect(environmentOf(["site:x", "production"])).toBe("PRODUCTION");
    expect(environmentOf(["env:staging"])).toBe("STAGING");
    expect(environmentOf(["lab"])).toBeUndefined();
  });
});

describe("NetBox (recorded from NetBox 4.7.2)", () => {
  const doc = netboxInventory(netboxFixture as never);
  const batch = batchOf(doc);

  it("imports devices and VMs, skipping planned and decommissioning ones", () => {
    expect(batch.errors).toEqual([]);
    expect(batch.resources.map((r) => [r.input.name, r.input.type]).sort()).toEqual([
      ["nas01", "STORAGE"],
      ["srv01", "SERVER"],
      ["srv02", "SERVER"],
      ["sw01", "NETWORK"],
      ["web-vm", "VM"],
    ]);
    const srv01 = batch.resources.find((r) => r.input.name === "srv01")!;
    expect(srv01.key).toBe("netbox/device/1");
    expect(srv01.input).toMatchObject({
      environment: "PRODUCTION",
      metadata: { os: "Ubuntu 24.04", ipAddresses: ["10.10.0.11", "192.168.50.11"] },
    });
    expect(srv01.input.tags).toEqual(
      expect.arrayContaining(["netbox", "site:dc-madrid", "tenant:acme", "cluster:prod-cluster"]),
    );
  });

  it("draws the VM on its device and makes machines depend on the switch they are cabled to", () => {
    const rel = batch.relationships.map((r) => [r.from, r.type, r.to, !!r.suggested]);
    expect(rel).toEqual(
      expect.arrayContaining([
        ["netbox/device/1", "HOSTS", "netbox/vm/1", false],
        ["netbox/device/1", "DEPENDS_ON", "netbox/device/3", false],
        ["netbox/device/2", "DEPENDS_ON", "netbox/device/3", false],
        ["netbox/device/4", "DEPENDS_ON", "netbox/device/3", false],
      ]),
    );
    expect(rel).toHaveLength(4);
  });

  it("sends v1 tokens as Token and v2 tokens as Bearer, paging through results", async () => {
    for (const [token, header] of [
      [
        "0123456789abcdef0123456789abcdef01234567",
        "Token 0123456789abcdef0123456789abcdef01234567",
      ],
      ["nbt_H1hEid5Y2oZw.secretpart", "Bearer nbt_H1hEid5Y2oZw.secretpart"],
    ] as const) {
      const { deps, calls } = fakeLocal(({ url }) => ({
        body: {
          results:
            url.includes("offset=0") && url.includes("dcim/devices") ? netboxFixture.devices : [],
          next: null,
        },
      }));
      const out = await netbox.fetchExport({ url: "https://netbox.lan" }, { token }, deps);
      expect(out.format).toBe("inventory");
      expect(calls.every((c) => c.headers.authorization === header)).toBe(true);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
        "/api/dcim/devices/",
        "/api/virtualization/virtual-machines/",
        "/api/ipam/ip-addresses/",
        "/api/dcim/cables/",
      ]);
    }
  });

  it("explains a rejected token", async () => {
    const { deps } = fakeLocal(() => ({ status: 403, body: { detail: "Invalid v1 token" } }));
    await expect(
      netbox.fetchExport({ url: "https://netbox.lan" }, { token: "wrongtoken123" }, deps),
    ).rejects.toThrow(/NetBox: the API token was rejected/);
  });
});

describe("Zabbix (recorded from Zabbix 7.0.31)", () => {
  const doc = zabbixInventory(
    zabbixFixture.hosts as never,
    zabbixFixture.triggers as never,
    new Map(
      zabbixFixture.dependencyTriggers.map((d) => [d.triggerid, d.hosts.map((h) => h.hostid)]),
    ),
  );
  const batch = batchOf(doc);
  const byName = (name: string) => batch.resources.find((r) => r.input.name === name)!;

  it("imports monitored hosts with their type, IPs, OS and point of contact", () => {
    expect(batch.errors).toEqual([]);
    expect(batch.resources.map((r) => r.input.name)).not.toContain("off01"); // disabled
    expect(byName("APP01 – billing").input).toMatchObject({
      type: "SERVER",
      environment: "PRODUCTION",
      owner: "Billing team",
      ownerContact: "billing@corp.lan",
      metadata: { hostname: "app01.corp.lan", os: "Ubuntu 24.04", ipAddresses: ["10.20.0.11"] },
    });
    expect(byName("core-sw1").input.type).toBe("NETWORK"); // SNMP only
    expect(byName("build-vm").input.type).toBe("VM");
    expect(byName("Zabbix server").input.metadata.ipAddresses).toBeUndefined(); // 127.0.0.1
  });

  it("turns cross-host trigger dependencies into suggestions, never confirmed", () => {
    const names = new Map(batch.resources.map((r) => [r.key, r.input.name]));
    const rel = batch.relationships.map((r) => [
      names.get(r.from),
      r.type,
      names.get(r.to),
      r.suggested,
    ]);
    expect(rel).toEqual(
      expect.arrayContaining([
        ["APP01 – billing", "DEPENDS_ON", "db01", true],
        ["APP01 – billing", "DEPENDS_ON", "core-sw1", true],
        ["db01", "DEPENDS_ON", "core-sw1", true],
      ]),
    );
    expect(rel.every((r) => r[3] === true)).toBe(true);
  });

  it("authenticates with the header from 6.4 and with the auth field before", async () => {
    for (const [version, header, field] of [
      ["7.0.31", true, false],
      ["6.0.40", false, true],
    ] as const) {
      const { deps, calls } = fakeLocal(({ body }) => {
        const method = JSON.parse(body!).method as string;
        return {
          body: {
            jsonrpc: "2.0",
            id: 1,
            result:
              method === "apiinfo.version"
                ? version
                : method === "host.get"
                  ? zabbixFixture.hosts
                  : [],
          },
        };
      });
      await zabbix.fetchExport(
        { url: "https://zbx.lan/zabbix" },
        { token: "t0ken-abcdefgh" },
        deps,
      );
      expect(calls[0]!.url).toBe("https://zbx.lan/zabbix/api_jsonrpc.php");
      const [first, ...rest] = calls;
      expect(first!.headers.authorization).toBeUndefined(); // apiinfo.version: never authenticated
      for (const c of rest) {
        expect(c.headers.authorization === "Bearer t0ken-abcdefgh").toBe(header);
        expect(JSON.parse(c.body!).auth === "t0ken-abcdefgh").toBe(field);
      }
      expect(JSON.parse(rest[0]!.body!).params).toHaveProperty(
        version.startsWith("7") ? "selectHostGroups" : "selectGroups",
      );
    }
  });

  it("explains a rejected token", async () => {
    const { deps } = fakeLocal(({ body }) =>
      JSON.parse(body!).method === "apiinfo.version"
        ? { body: { result: "7.0.31" } }
        : {
            body: { error: { code: -32602, message: "Invalid params.", data: "Not authorized." } },
          },
    );
    await expect(
      zabbix.fetchExport({ url: "https://zbx.lan" }, { token: "t0ken-abcdefgh" }, deps),
    ).rejects.toThrow(/Zabbix: the API token was rejected/);
  });
});

describe("PRTG (Preview: built from the API v1 documentation)", () => {
  const devices = [
    {
      objid: 2001,
      device: "dc01",
      host: "10.30.0.10",
      group: "Servers",
      probe: "Local Probe",
      tags: "windows prod",
    },
    {
      objid: 2002,
      device: "core-switch",
      host: "10.30.0.1",
      group: "Network",
      probe: "Local Probe",
      tags: "snmp switch",
    },
    {
      objid: 2003,
      device: "mail",
      host: "mail.corp.lan",
      group: "Servers",
      probe: "Remote Probe",
      tags: "",
    },
  ];

  it("imports devices with their address, group and probe", () => {
    const batch = batchOf(prtgInventory(devices));
    expect(batch.errors).toEqual([]);
    expect(batch.resources.map((r) => [r.input.name, r.input.type, r.input.environment])).toEqual([
      ["dc01", "SERVER", "PRODUCTION"],
      ["core-switch", "NETWORK", null],
      ["mail", "SERVER", null],
    ]);
    expect(batch.resources[2]!.input.metadata).toMatchObject({
      fqdn: "mail.corp.lan",
      hostname: "mail",
    });
    expect(batch.resources[0]!.input.tags).toEqual(
      expect.arrayContaining(["prtg", "group:servers", "probe:local-probe", "windows"]),
    );
  });

  it("asks the devices table with the API token", async () => {
    const { deps, calls } = fakeLocal(() => ({ body: { devices } }));
    await prtg.fetchExport({ url: "https://prtg.lan" }, { apiToken: "PRTGTOKEN1234" }, deps);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/table.json");
    expect(url.searchParams.get("content")).toBe("devices");
    expect(url.searchParams.get("apitoken")).toBe("PRTGTOKEN1234");
  });
});
