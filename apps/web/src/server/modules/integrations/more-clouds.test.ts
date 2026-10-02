// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M27 sources against fixtures shaped like each provider's documented API
 * responses: Vultr API v2, Linode API v4, IONOS Cloud API v6, OCI Core /
 * Identity / Load Balancing (with request signatures) and the Tailscale API.
 */
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseImport } from "@/server/modules/importers/parse";
import { planImport, type ExistingResource } from "@/server/modules/importers/plan";
import type { SafeResponse } from "@/server/safe-fetch";
import { ionos, linode, ociAuthorization, oracleCloud, vultr } from "./more-clouds";
import type { Http } from "./provider-base";
import { tailscale } from "./tailscale";

const res = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): SafeResponse => ({
  status,
  headers: new Headers(headers),
  text: typeof body === "string" ? body : JSON.stringify(body),
});

type Route = [string | RegExp, (url: string) => SafeResponse];

function fakeHttp(routes: Route[]) {
  const calls: { url: string; headers?: Record<string, string>; body?: string }[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body });
    const route = routes.find(([m]) => (typeof m === "string" ? url.startsWith(m) : m.test(url)));
    if (!route) throw new Error(`unexpected ${url}`);
    return route[1](url);
  };
  return { http, calls };
}

const TOKEN = "t".repeat(64);
const planOf = (text: string, format: "cloud" | "tailscale", existing: ExistingResource[] = []) => {
  const batch = parseImport(text, format);
  expect(batch.errors).toEqual([]);
  return planImport(batch, existing, []);
};
const rels = (plan: ReturnType<typeof planImport>) =>
  plan.relationships.map((r) => `${r.fromLabel} ${r.type} ${r.toLabel}`);

describe("vultr", () => {
  it("follows cursors and maps instances, load balancers and databases", async () => {
    const { http, calls } = fakeHttp([
      [
        /\/instances\?per_page=500$/,
        () =>
          res(200, {
            instances: [
              {
                id: "inst-1",
                label: "web-1",
                hostname: "web-1",
                os: "Ubuntu 24.04 LTS x64",
                region: "fra",
                plan: "vc2-1c-1gb",
                main_ip: "203.0.113.5",
                v6_main_ip: "::",
                internal_ip: "10.1.96.3",
                power_status: "running",
                tags: ["env:production"],
              },
            ],
            meta: { links: { next: "bmV4dA==" } },
          }),
      ],
      [
        /\/instances\?per_page=500&cursor=bmV4dA%3D%3D/,
        () =>
          res(200, {
            instances: [{ id: "inst-2", label: "web-2", main_ip: "203.0.113.6" }],
            meta: { links: { next: "" } },
          }),
      ],
      [
        "https://api.vultr.com/v2/load-balancers",
        () =>
          res(200, {
            load_balancers: [
              {
                id: "lb-1",
                label: "web-lb",
                region: "fra",
                ipv4: "198.51.100.9",
                instances: ["inst-1", "inst-2"],
                forwarding_rules: [{ frontend_port: 443 }],
              },
            ],
          }),
      ],
      [
        "https://api.vultr.com/v2/databases",
        () =>
          res(200, {
            databases: [
              {
                id: "db-1",
                label: "orders",
                database_engine: "pg",
                database_engine_version: "16",
                host: "vultr-prod-1.vultrdb.com",
                port: "16751",
              },
            ],
          }),
      ],
    ]);
    const out = await vultr.fetchExport({}, { apiKey: "K".repeat(36) }, { http });
    expect(calls.every((c) => c.headers?.authorization === `Bearer ${"K".repeat(36)}`)).toBe(true);
    const plan = planOf(out.text, "cloud");
    expect(plan.resources.map((r) => `${r.type} ${r.name}`)).toEqual([
      "VM web-1",
      "VM web-2",
      "DATABASE orders",
      "NETWORK web-lb",
    ]);
    expect(plan.resources[0]!.input).toMatchObject({
      environment: "PRODUCTION",
      metadata: { ipAddresses: ["203.0.113.5", "10.1.96.3"] }, // "::" is no address
    });
    expect(plan.resources[2]!.input.metadata).toMatchObject({
      hostname: "vultr-prod-1.vultrdb.com",
      ports: [16751],
    });
    expect(rels(plan)).toEqual(["web-1 EXPOSED_THROUGH web-lb", "web-2 EXPOSED_THROUGH web-lb"]);
  });
});

describe("linode", () => {
  it("maps NodeBalancer backend nodes to the Linodes owning their private IPs", async () => {
    const { http } = fakeHttp([
      [
        "https://api.linode.com/v4/linode/instances",
        () =>
          res(200, {
            data: [
              {
                id: 101,
                label: "app-1",
                region: "eu-central",
                type: "g6-standard-2",
                image: "linode/debian12",
                status: "running",
                ipv4: ["172.105.1.10", "192.168.130.20"],
                ipv6: "2a01:7e01::f03c:94ff:fe11:2233/128",
                tags: ["app"],
              },
            ],
            page: 1,
            pages: 1,
          }),
      ],
      [
        /\/nodebalancers\/7\/configs\/3\/nodes/,
        () => res(200, { data: [{ address: "192.168.130.20:8080" }], pages: 1 }),
      ],
      [/\/nodebalancers\/7\/configs\?/, () => res(200, { data: [{ id: 3, port: 443 }], pages: 1 })],
      [
        "https://api.linode.com/v4/nodebalancers?",
        () =>
          res(200, {
            data: [
              {
                id: 7,
                label: "app-nb",
                region: "eu-central",
                hostname: "nb-172-105-2-2.frankfurt.nodebalancer.linode.com",
                ipv4: "172.105.2.2",
              },
            ],
            pages: 1,
          }),
      ],
      [
        "https://api.linode.com/v4/databases/instances",
        () => res(403, { errors: [{ reason: "scope" }] }),
      ],
    ]);
    const out = await linode.fetchExport({}, { apiToken: TOKEN }, { http });
    const plan = planOf(out.text, "cloud");
    expect(plan.resources[0]!.input.metadata.ipAddresses).toEqual([
      "172.105.1.10",
      "192.168.130.20",
      "2a01:7e01::f03c:94ff:fe11:2233",
    ]);
    expect(plan.resources[1]!.input.description).toBe("Linode NodeBalancer · eu-central");
    expect(rels(plan)).toEqual(["app-1 EXPOSED_THROUGH app-nb"]);
  });
});

describe("ionos", () => {
  it("lists servers of every data center with their NIC IPs", async () => {
    const { http } = fakeHttp([
      [
        "https://api.ionos.com/cloudapi/v6/datacenters?",
        () => res(200, { items: [{ id: "dc-1", properties: { location: "de/fra" } }] }),
      ],
      [
        "https://api.ionos.com/cloudapi/v6/datacenters/dc-1/servers",
        () =>
          res(200, {
            items: [
              {
                id: "srv-1",
                properties: { name: "erp", cores: 4, ram: 8192, vmState: "RUNNING" },
                entities: {
                  nics: {
                    items: [
                      { properties: { ips: ["85.215.1.2"] } },
                      { properties: { ips: ["10.7.0.4"] } },
                    ],
                  },
                },
              },
            ],
          }),
      ],
    ]);
    const out = await ionos.fetchExport({}, { apiToken: TOKEN }, { http });
    const plan = planOf(out.text, "cloud");
    expect(plan.resources[0]!.input).toMatchObject({
      name: "erp",
      description: "IONOS Cloud · 4 vCores / 8 GB RAM · de/fra · RUNNING",
      metadata: { ipAddresses: ["85.215.1.2", "10.7.0.4"] },
    });
  });
});

describe("oracle cloud", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const config = {
    tenancy: "ocid1.tenancy.oc1..aaaaaaaaba3pv6wkcr4jqae5f15p2b2m2yt2j6rx32uzr4h25vqstifsfdsq",
    user: "ocid1.user.oc1..aaaaaaaa65vwl75tewwm32rgqvm6i34unq2ul3xw4ywxtcmlmuquu6bf5kbq",
    fingerprint: "20:3b:97:13:55:1c:5b:0d:d3:37:d8:50:4e:c5:3a:34",
    region: "eu-frankfurt-1",
    compartment: "",
  };

  it("signs requests the way OCI verifies them", () => {
    const url = new URL(
      "https://iaas.eu-frankfurt-1.oraclecloud.com/20160918/instances?compartmentId=x&limit=1000",
    );
    const date = "Thu, 05 Jan 2026 21:31:40 GMT";
    const auth = ociAuthorization({ ...config, privateKey: pem }, url, date);
    expect(auth).toContain(`keyId="${config.tenancy}/${config.user}/${config.fingerprint}"`);
    expect(auth).toContain('headers="x-date (request-target) host"');
    const signature = /signature="([^"]+)"/.exec(auth)![1]!;
    const signing = `x-date: ${date}\n(request-target): get /20160918/instances?compartmentId=x&limit=1000\nhost: iaas.eu-frankfurt-1.oraclecloud.com`;
    expect(createVerify("RSA-SHA256").update(signing).verify(publicKey, signature, "base64")).toBe(
      true,
    );
  });

  it("walks compartments, pages instances and reads VNIC addresses", async () => {
    const C2 = "ocid1.compartment.oc1..aaaaaaaaxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const { http, calls } = fakeHttp([
      [
        "https://identity.eu-frankfurt-1.oraclecloud.com/20160918/compartments",
        () => res(200, [{ id: C2 }]),
      ],
      [
        /\/20160918\/instances\?compartmentId=ocid1\.tenancy[^&]*&limit=1000$/,
        () =>
          res(
            200,
            [
              {
                id: "inst-a",
                displayName: "app-a",
                shape: "VM.Standard.E4.Flex",
                lifecycleState: "RUNNING",
              },
            ],
            {
              "opc-next-page": "p2",
            },
          ),
      ],
      [
        /\/20160918\/instances\?compartmentId=ocid1\.tenancy.*page=p2/,
        () => res(200, [{ id: "inst-b", displayName: "old", lifecycleState: "TERMINATED" }]),
      ],
      [/\/20160918\/instances\?compartmentId=ocid1\.compartment/, () => res(200, [])],
      [
        /\/20160918\/vnicAttachments/,
        () => res(200, [{ instanceId: "inst-a", vnicId: "vnic-1", lifecycleState: "ATTACHED" }]),
      ],
      [
        /\/20160918\/vnics\/vnic-1/,
        () => res(200, { privateIp: "10.0.0.15", publicIp: "130.61.1.2", hostnameLabel: "app-a" }),
      ],
      [
        /\/20170115\/loadBalancers\?compartmentId=ocid1\.tenancy/,
        () =>
          res(200, [
            {
              id: "lb-1",
              displayName: "public-lb",
              ipAddresses: [{ ipAddress: "130.61.9.9" }],
              listeners: { https: { port: 443 } },
              backendSets: { app: { backends: [{ ipAddress: "10.0.0.15", port: 8080 }] } },
            },
          ]),
      ],
      [/\/20170115\/loadBalancers/, () => res(200, [])],
    ]);
    const out = await oracleCloud.fetchExport(config, { privateKey: pem }, { http });
    expect(
      calls
        .filter((c) => c.url.includes("oraclecloud.com"))
        .every((c) => c.headers?.authorization?.startsWith('Signature version="1"')),
    ).toBe(true);
    const plan = planOf(out.text, "cloud");
    expect(plan.resources.map((r) => `${r.type} ${r.name}`)).toEqual([
      "VM app-a",
      "NETWORK public-lb",
    ]);
    expect(plan.resources[0]!.input.metadata).toMatchObject({
      hostname: "app-a",
      ipAddresses: ["10.0.0.15", "130.61.1.2"],
    });
    expect(rels(plan)).toEqual(["app-a EXPOSED_THROUGH public-lb"]);
  });

  it("validates OCIDs and the key", () => {
    expect(oracleCloud.configSchema.safeParse({ ...config, tenancy: "x" }).success).toBe(false);
    expect(oracleCloud.secretSchema.safeParse({ privateKey: "nope" }).success).toBe(false);
  });
});

describe("tailscale", () => {
  const devices = {
    devices: [
      {
        nodeId: "n1",
        name: "app01.tail1234.ts.net",
        hostname: "APP01",
        addresses: ["100.101.1.1", "fd7a:115c:a1e0::1"],
        os: "windows",
        tags: [],
      },
      {
        nodeId: "n2",
        name: "nas.tail1234.ts.net",
        hostname: "nas",
        addresses: ["100.101.1.2"],
        os: "linux",
        tags: ["tag:server"],
      },
      {
        nodeId: "n3",
        name: "alice-laptop.tail1234.ts.net",
        hostname: "alice-laptop",
        addresses: ["100.101.1.3"],
        os: "macOS",
      },
    ],
  };
  const existing: ExistingResource = {
    id: "res-app01",
    name: "APP01",
    type: "SERVER",
    source: "AGENT",
    externalId: null,
    environment: null,
    criticality: null,
    description: null,
    notes: null,
    tags: ["windows"],
    metadata: { ipAddresses: ["10.0.0.21"], hostname: "app01" },
  };

  it("uses an OAuth client token, then adds addresses to the matching machine", async () => {
    const { http, calls } = fakeHttp([
      ["https://api.tailscale.com/api/v2/oauth/token", () => res(200, { access_token: "tok" })],
      ["https://api.tailscale.com/api/v2/tailnet/-/devices", () => res(200, devices)],
    ]);
    const out = await tailscale.fetchExport(
      tailscale.configSchema.parse({}),
      { clientId: "kABC123", secret: "tskey-client-kABC123-secretvalue" },
      { http },
    );
    expect(calls[0]!.body).toContain("client_id=kABC123");
    expect(calls[1]!.headers?.authorization).toBe("Bearer tok");

    const plan = planOf(out.text, "tailscale", [existing]);
    expect(plan.resources.map((r) => [r.name, r.action, r.targetId])).toEqual([
      ["APP01", "update", "res-app01"], // the agent's server: addresses added
      ["nas", "create", null], // tagged: a server
    ]);
    const app = plan.resources[0]!;
    expect(app.type).toBe("SERVER");
    expect(app.changes).toEqual(["ipAddresses", "tags"]);
    expect(app.input.metadata.ipAddresses).toEqual([
      "10.0.0.21",
      "100.101.1.1",
      "fd7a:115c:a1e0::1",
    ]);
    expect(app.input.tags).toEqual(["windows", "tailscale"]);
    expect(plan.warnings.join(" ")).toMatch(/alice-laptop is not in the Library — skipped/);

    // Second sync: nothing left to add.
    const again = planOf(out.text, "tailscale", [
      {
        ...existing,
        tags: app.input.tags,
        metadata: { ...existing.metadata, ipAddresses: app.input.metadata.ipAddresses },
      },
    ]);
    expect(again.resources[0]!.action).toBe("unchanged");
  });

  it("an API token is used as is; a bad secret is refused", async () => {
    const { http, calls } = fakeHttp([
      [
        "https://api.tailscale.com/api/v2/tailnet/example.com/devices",
        () => res(200, { devices: [] }),
      ],
    ]);
    await tailscale.fetchExport(
      { tailnet: "example.com", create: "none" },
      { secret: "tskey-api-kXYZ-abcdefghijk" },
      { http },
    );
    expect(calls[0]!.headers?.authorization).toBe("Bearer tskey-api-kXYZ-abcdefghijk");
    expect(tailscale.secretSchema.safeParse({ secret: "abc" }).success).toBe(false);
  });
});
