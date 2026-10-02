// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M27: DNS records as an option of the cloud integrations (Hetzner Cloud
 * zones / rrsets, DigitalOcean domains, OVHcloud /domain/zone, Route 53, Azure
 * DNS), plus AWS ELBv2 and Azure load balancers / managed databases. Fixtures
 * follow each provider's documented response shapes.
 */
import { describe, expect, it } from "vitest";
import { absoluteName } from "@/server/modules/importers/parse-platforms";
import { parseImport } from "@/server/modules/importers/parse";
import { planImport } from "@/server/modules/importers/plan";
import type { SafeResponse } from "@/server/safe-fetch";
import { digitalocean, hetzner, ovhcloud } from "./cloud-providers";
import { aws, azure, type AwsApi, type Http } from "./providers";

const res = (status: number, body: unknown): SafeResponse => ({
  status,
  headers: new Headers(),
  text: typeof body === "string" ? body : JSON.stringify(body),
});

type Route = [string | RegExp, (url: string) => SafeResponse];

function fakeHttp(routes: Route[]) {
  const calls: string[] = [];
  const http: Http = async (url) => {
    calls.push(url);
    const route = routes.find(([m]) => (typeof m === "string" ? url.startsWith(m) : m.test(url)));
    if (!route) throw new Error(`unexpected ${url}`);
    return route[1](url);
  };
  return { http, calls };
}

const TOKEN = "t".repeat(64);
const parsed = (format: Parameters<typeof parseImport>[1], text: string) => {
  const batch = parseImport(text, format);
  expect(batch.errors).toEqual([]);
  return batch;
};
const rels = (plan: ReturnType<typeof planImport>) =>
  plan.relationships.map((r) => `${r.fromLabel} ${r.type} ${r.toLabel}`);

describe("absoluteName", () => {
  it("resolves zone-relative names and targets", () => {
    expect(absoluteName("@", "example.com")).toBe("example.com");
    expect(absoluteName("www", "example.com")).toBe("www.example.com");
    expect(absoluteName("www.example.com.", "example.com")).toBe("www.example.com");
    expect(absoluteName("lb.other.net", "example.com")).toBe("lb.other.net");
    expect(absoluteName("WWW.Example.com", "example.com")).toBe("www.example.com");
  });
});

describe("hetzner DNS", () => {
  const routes = (): Route[] => [
    [
      "https://api.hetzner.cloud/v1/servers",
      () =>
        res(200, {
          servers: [{ id: 1, name: "web-1", public_net: { ipv4: { ip: "203.0.113.10" } } }],
          meta: { pagination: { next_page: null } },
        }),
    ],
    ["https://api.hetzner.cloud/v1/load_balancers", () => res(200, { load_balancers: [] })],
    [
      "https://api.hetzner.cloud/v1/zones?",
      () => res(200, { zones: [{ id: 9, name: "example.com" }] }),
    ],
    [
      "https://api.hetzner.cloud/v1/zones/9/rrsets",
      () =>
        res(200, {
          rrsets: [
            { name: "@", type: "A", records: [{ value: "203.0.113.10" }] },
            { name: "www", type: "CNAME", records: [{ value: "example.com." }] },
            { name: "blog", type: "CNAME", records: [{ value: "hosted.blogs.net." }] },
            { name: "mail", type: "MX", records: [{ value: "10 mx.example.com." }] },
            { name: "_dmarc", type: "TXT", records: [{ value: "v=DMARC1" }] },
          ],
        }),
    ],
  ];

  it("off by default: never reads zones", async () => {
    const { http, calls } = fakeHttp(routes());
    await hetzner.fetchExport(hetzner.configSchema.parse({}), { apiToken: TOKEN }, { http });
    expect(calls.some((c) => c.includes("/zones"))).toBe(false);
  });

  it("linked: records pointing to its own servers on the first sync, CNAMEs included", async () => {
    const { http } = fakeHttp(routes());
    const out = await hetzner.fetchExport(
      { dns: "linked" },
      { apiToken: TOKEN },
      { http, libraryIps: async () => new Set() },
    );
    const batch = parsed("cloud", out.text);
    const names = batch.resources.filter((r) => r.input.type === "DOMAIN").map((r) => r.input.name);
    expect(names).toEqual(["example.com", "www.example.com"]);
    expect(rels(planImport(batch, [], []))).toEqual([
      "example.com DEPENDS_ON web-1",
      "www.example.com DEPENDS_ON example.com",
    ]);
    expect(batch.resources.at(-1)!.input.description).toBe(
      "CNAME → example.com · Hetzner Cloud DNS",
    );
  });

  it("all: every A / AAAA / CNAME", async () => {
    const { http } = fakeHttp(routes());
    const out = await hetzner.fetchExport({ dns: "all" }, { apiToken: TOKEN }, { http });
    expect(JSON.parse(out.text).dns.map((r: { name: string }) => r.name)).toEqual([
      "example.com",
      "www.example.com",
      "blog.example.com",
    ]);
  });
});

describe("digitalocean DNS", () => {
  it("reads every domain's records", async () => {
    const { http } = fakeHttp([
      ["https://api.digitalocean.com/v2/droplets", () => res(200, { droplets: [] })],
      ["https://api.digitalocean.com/v2/load_balancers", () => res(403, { message: "scope" })],
      ["https://api.digitalocean.com/v2/databases", () => res(403, { message: "scope" })],
      [
        "https://api.digitalocean.com/v2/domains?",
        () => res(200, { domains: [{ name: "example.org" }] }),
      ],
      [
        "https://api.digitalocean.com/v2/domains/example.org/records",
        () =>
          res(200, {
            domain_records: [
              { type: "A", name: "@", data: "198.51.100.7" },
              { type: "CNAME", name: "app", data: "@" },
              { type: "NS", name: "@", data: "ns1.digitalocean.com" },
            ],
          }),
      ],
    ]);
    const out = await digitalocean.fetchExport(
      { dns: "linked" },
      { apiToken: TOKEN },
      { http, libraryIps: async () => new Set(["198.51.100.7"]) },
    );
    expect(JSON.parse(out.text).dns).toEqual([
      { zone: "example.org", name: "example.org", type: "A", content: "198.51.100.7" },
      { zone: "example.org", name: "app.example.org", type: "CNAME", content: "example.org" },
    ]);
  });
});

describe("ovhcloud DNS", () => {
  it("lists zones, record ids per type and each record", async () => {
    const base = "https://eu.api.ovh.com/1.0";
    const zone = `${base}/domain/zone/inframole.com/record`;
    const { http, calls } = fakeHttp([
      [`${base}/auth/time`, () => res(200, String(Math.floor(Date.now() / 1000)))],
      [`${base}/cloud/project`, () => res(200, [])],
      [`${base}/vps`, () => res(200, [])],
      [`${base}/dedicated/server`, () => res(200, [])],
      [`${zone}?fieldType=AAAA`, () => res(200, [])],
      [`${zone}?fieldType=A`, () => res(200, [1])],
      [`${zone}?fieldType=CNAME`, () => res(200, [2])],
      [`${zone}/1`, () => res(200, { subDomain: "", fieldType: "A", target: "146.59.154.3" })],
      [
        `${zone}/2`,
        () => res(200, { subDomain: "www", fieldType: "CNAME", target: "inframole.com." }),
      ],
      [`${base}/domain/zone`, () => res(200, ["inframole.com"])],
    ]);
    const out = await ovhcloud.fetchExport(
      ovhcloud.configSchema.parse({ endpoint: "ovh-eu", dns: "all" }),
      {
        applicationKey: "appkey12345",
        applicationSecret: "s".repeat(20),
        consumerKey: "c".repeat(20),
      },
      { http },
    );
    expect(JSON.parse(out.text).dns.map((r: { name: string }) => r.name)).toEqual([
      "inframole.com",
      "www.inframole.com",
    ]);
    expect(calls.filter((c) => /\/record\/\d/.test(c)).length).toBe(2);
  });
});

/** AWS API fake: nothing unless overridden. */
const fakeAws = (over: Partial<AwsApi>): AwsApi => ({
  describeInstances: async () => ({}),
  describeDbInstances: async () => ({}),
  describeLoadBalancers: async () => ({}),
  describeListeners: async () => ({}),
  describeTargetGroups: async () => ({}),
  describeTargetHealth: async () => ({}),
  listHostedZones: async () => ({}),
  listRecordSets: async () => ({}),
  ...over,
});

describe("aws load balancers and Route 53", () => {
  const LB_ARN = "arn:aws:elasticloadbalancing:eu-west-1:1:loadbalancer/app/shop/abc";
  const api = fakeAws({
    describeInstances: async () =>
      ({
        Reservations: [
          {
            Instances: [
              { InstanceId: "i-web1", State: { Name: "running" }, PrivateIpAddress: "10.0.1.5" },
              { InstanceId: "i-web2", State: { Name: "running" }, PrivateIpAddress: "10.0.1.6" },
            ],
          },
        ],
      }) as never,
    describeDbInstances: async () => ({
      DBInstances: [
        {
          DBInstanceIdentifier: "orders",
          Engine: "postgres",
          Endpoint: { Address: "orders.abc.eu-west-1.rds.amazonaws.com", Port: 5432 },
        },
      ],
    }),
    describeLoadBalancers: async () => ({
      LoadBalancers: [
        {
          LoadBalancerArn: LB_ARN,
          LoadBalancerName: "shop",
          DNSName: "shop-123.eu-west-1.elb.amazonaws.com",
          Type: "application",
          AvailabilityZones: [{ ZoneName: "eu-west-1a" }],
        },
      ],
    }),
    describeListeners: async () => ({ Listeners: [{ Port: 443 }, { Port: 80 }] }),
    describeTargetGroups: async () => ({
      TargetGroups: [
        { TargetGroupArn: "tg-1", TargetType: "instance" },
        { TargetGroupArn: "tg-2", TargetType: "ip" },
      ],
    }),
    describeTargetHealth: async (arn) =>
      arn === "tg-1"
        ? { TargetHealthDescriptions: [{ Target: { Id: "i-web1" } }, { Target: { Id: "i-web2" } }] }
        : { TargetHealthDescriptions: [{ Target: { Id: "10.0.9.9" } }] },
    listHostedZones: async () => ({ HostedZones: [{ Id: "/hostedzone/Z1", Name: "shop.com." }] }),
    listRecordSets: async () => ({
      ResourceRecordSets: [
        {
          Name: "shop.com.",
          Type: "A",
          AliasTarget: { DNSName: "dualstack.shop-123.eu-west-1.elb.amazonaws.com." },
        },
        {
          Name: "db.shop.com.",
          Type: "CNAME",
          ResourceRecords: [{ Value: "orders.abc.eu-west-1.rds.amazonaws.com" }],
        },
        { Name: "\\052.shop.com.", Type: "A", ResourceRecords: [{ Value: "192.0.2.1" }] },
        { Name: "shop.com.", Type: "MX", ResourceRecords: [{ Value: "10 mx.shop.com." }] },
      ],
    }),
  });

  it("imports ALB targets as EXPOSED_THROUGH and links alias / CNAME records", async () => {
    const out = await aws.fetchExport(
      { region: "eu-west-1", dns: "linked" },
      { accessKeyId: "AKIAABCDEFGHIJKLMNOP", secretAccessKey: "x".repeat(40) },
      { http: async () => res(500, {}), aws: () => api, libraryIps: async () => new Set() },
    );
    const batch = parsed("json", out.text);
    expect(batch.format).toBe("aws");
    const lb = batch.resources.find((r) => r.input.type === "NETWORK")!;
    expect(lb.input).toMatchObject({
      name: "shop",
      description: "AWS Application Load Balancer · eu-west-1",
      metadata: { hostname: "shop-123.eu-west-1.elb.amazonaws.com", ports: [80, 443] },
    });
    const plan = planImport(batch, [], []);
    expect(rels(plan)).toEqual([
      "i-web1 EXPOSED_THROUGH shop",
      "i-web2 EXPOSED_THROUGH shop",
      "shop.com DEPENDS_ON shop",
      "db.shop.com DEPENDS_ON orders",
    ]);
    // The unknown IP target is a warning, not an error.
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/10\.0\.9\.9/);
  });

  it("explains a missing Route 53 permission", async () => {
    const denied = fakeAws({
      listHostedZones: async () => {
        throw Object.assign(new Error("x"), { name: "AccessDenied" });
      },
    });
    await expect(
      aws.fetchExport(
        { region: "eu-west-1", dns: "all" },
        { accessKeyId: "AKIAABCDEFGHIJKLMNOP", secretAccessKey: "x".repeat(40) },
        { http: async () => res(500, {}), aws: () => denied },
      ),
    ).rejects.toThrow(/Route 53: AccessDenied — allow route53:ListHostedZones/);
  });
});

describe("azure load balancers, databases and DNS", () => {
  const SUB = "22222222-2222-2222-2222-222222222222";
  const rg = `/subscriptions/${SUB}/resourceGroups/rg`;
  const vm = (n: string) => `${rg}/providers/Microsoft.Compute/virtualMachines/${n}`;
  const nic = (n: string) => `${rg}/providers/Microsoft.Network/networkInterfaces/${n}-nic`;
  const pip = `${rg}/providers/Microsoft.Network/publicIPAddresses/lb-ip`;
  const sql = `${rg}/providers/Microsoft.Sql/servers/acme-sql`;
  const zone = `${rg}/providers/Microsoft.Network/dnszones/acme.com`;
  const list = (value: unknown[]) => () => res(200, { value });

  it("maps backend pools to VMs, lists SQL databases and resolves DNS aliases", async () => {
    const { http } = fakeHttp([
      ["https://login.microsoftonline.com/", () => res(200, { access_token: "tok" })],
      [
        /virtualMachines\?/,
        list(
          ["web-1", "web-2"].map((n) => ({
            id: vm(n),
            name: n,
            properties: { networkProfile: { networkInterfaces: [{ id: nic(n) }] } },
          })),
        ),
      ],
      [
        /networkInterfaces\?/,
        list(
          ["web-1", "web-2"].map((n, i) => ({
            id: nic(n),
            properties: {
              virtualMachine: { id: vm(n) },
              ipConfigurations: [{ properties: { privateIPAddress: `10.0.0.${i + 4}` } }],
            },
          })),
        ),
      ],
      [/publicIPAddresses\?/, list([{ id: pip, properties: { ipAddress: "20.1.2.3" } }])],
      [
        /loadBalancers\?/,
        list([
          {
            id: `${rg}/providers/Microsoft.Network/loadBalancers/web-lb`,
            name: "web-lb",
            location: "westeurope",
            properties: {
              frontendIPConfigurations: [{ properties: { publicIPAddress: { id: pip } } }],
              loadBalancingRules: [{ properties: { frontendPort: 443 } }],
              backendAddressPools: [
                {
                  properties: {
                    backendIPConfigurations: ["web-1", "web-2"].map((n) => ({
                      id: `${nic(n)}/ipConfigurations/ipconfig1`,
                    })),
                  },
                },
              ],
            },
          },
        ]),
      ],
      [/applicationGateways\?/, () => res(403, { error: { message: "denied" } })],
      [
        /Microsoft\.Sql\/servers\?/,
        list([
          {
            id: sql,
            name: "acme-sql",
            properties: { fullyQualifiedDomainName: "acme-sql.database.windows.net" },
          },
        ]),
      ],
      [
        /servers\/acme-sql\/databases\?/,
        list([
          { id: `${sql}/databases/master`, name: "master" },
          { id: `${sql}/databases/orders`, name: "orders", sku: { name: "S0" } },
        ]),
      ],
      [
        /flexibleServers\?/,
        () => res(409, { error: { message: "MissingSubscriptionRegistration" } }),
      ],
      [/dnszones\?/, list([{ id: zone, name: "acme.com" }])],
      [
        /dnszones\/acme\.com\/all\?/,
        list([
          {
            name: "@",
            type: "Microsoft.Network/dnszones/A",
            properties: { fqdn: "acme.com.", targetResource: { id: pip } },
          },
          {
            name: "db",
            type: "Microsoft.Network/dnszones/CNAME",
            properties: {
              fqdn: "db.acme.com.",
              CNAMERecord: { cname: "acme-sql.database.windows.net" },
            },
          },
        ]),
      ],
    ]);
    const out = await azure.fetchExport(
      { tenantId: "11111111-1111-1111-1111-111111111111", subscriptionId: SUB, dns: "linked" },
      { clientId: "33333333-3333-3333-3333-333333333333", clientSecret: "super-secret-value" },
      { http, libraryIps: async () => new Set() },
    );
    const batch = parsed("json", out.text);
    expect(batch.format).toBe("azure");
    const plan = planImport(batch, [], []);
    expect(plan.resources.map((r) => `${r.type} ${r.name}`)).toEqual([
      "VM web-1",
      "VM web-2",
      "DATABASE orders (acme-sql)",
      "NETWORK web-lb",
      "DOMAIN acme.com",
      "DOMAIN db.acme.com",
    ]);
    expect(rels(plan)).toEqual([
      "web-1 EXPOSED_THROUGH web-lb",
      "web-2 EXPOSED_THROUGH web-lb",
      "acme.com DEPENDS_ON web-lb",
      "db.acme.com DEPENDS_ON orders (acme-sql)",
    ]);
  });
});
