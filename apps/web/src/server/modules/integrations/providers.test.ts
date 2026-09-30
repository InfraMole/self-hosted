// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseImport } from "@/server/modules/importers/parse";
import { planImport } from "@/server/modules/importers/plan";
import type { SafeResponse } from "@/server/safe-fetch";
import { IntegrationError, aws, azure, cloudflare, linkedRecords, type Http } from "./providers";

const res = (status: number, body: unknown): SafeResponse => ({
  status,
  headers: new Headers(),
  text: JSON.stringify(body),
});

/** Fake HTTP: routes by URL prefix, records calls. */
function fakeHttp(routes: [string | RegExp, (url: string, body?: string) => SafeResponse][]) {
  const calls: { url: string; headers?: Record<string, string>; body?: string }[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body });
    const route = routes.find(([m]) => (typeof m === "string" ? url.startsWith(m) : m.test(url)));
    if (!route) throw new Error(`unexpected ${url}`);
    return route[1](url, init?.body);
  };
  return { http, calls };
}

const TENANT = "11111111-1111-1111-1111-111111111111";
const SUB = "22222222-2222-2222-2222-222222222222";
const CLIENT = "33333333-3333-3333-3333-333333333333";

describe("azure provider", () => {
  const vmId = `/subscriptions/${SUB}/resourceGroups/RG-WEB/providers/Microsoft.Compute/virtualMachines/web-01`;
  const nicId = `/subscriptions/${SUB}/resourceGroups/RG-WEB/providers/Microsoft.Network/networkInterfaces/web-01-nic`;
  const pipId = `/subscriptions/${SUB}/resourceGroups/RG-WEB/providers/Microsoft.Network/publicIPAddresses/web-01-ip`;

  it("logs in with client credentials and shapes VMs like `az vm list -d`", async () => {
    const { http, calls } = fakeHttp([
      ["https://login.microsoftonline.com/", () => res(200, { access_token: "tok" })],
      [
        /virtualMachines\?/,
        () =>
          res(200, {
            value: [
              {
                id: vmId,
                name: "web-01",
                location: "westeurope",
                tags: { env: "prod" },
                properties: {
                  hardwareProfile: { vmSize: "Standard_B2s" },
                  storageProfile: { osDisk: { osType: "Linux" } },
                  networkProfile: { networkInterfaces: [{ id: nicId }] },
                },
              },
            ],
            nextLink: "https://evil.example/steal", // foreign host: never followed
          }),
      ],
      [
        /networkInterfaces\?/,
        () =>
          res(200, {
            value: [
              {
                id: nicId,
                properties: {
                  ipConfigurations: [
                    {
                      properties: { privateIPAddress: "10.1.0.4", publicIPAddress: { id: pipId } },
                    },
                  ],
                },
              },
            ],
          }),
      ],
      [
        /publicIPAddresses\?/,
        () => res(200, { value: [{ id: pipId, properties: { ipAddress: "20.50.1.2" } }] }),
      ],
    ]);
    const out = await azure.fetchExport(
      { tenantId: TENANT, subscriptionId: SUB },
      { clientId: CLIENT, clientSecret: "super-secret-value" },
      { http },
    );
    expect(out.format).toBe("azure");
    const login = calls[0]!;
    expect(login.url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    expect(login.body).toContain("grant_type=client_credentials");
    expect(calls.slice(1).every((c) => c.headers?.authorization === "Bearer tok")).toBe(true);
    expect(calls.some((c) => c.url.includes("evil.example"))).toBe(false);

    const batch = parseImport(out.text, "json");
    expect(batch.format).toBe("azure");
    expect(batch.resources[0]!.input).toMatchObject({
      name: "web-01",
      environment: "PRODUCTION",
      metadata: { ipAddresses: ["10.1.0.4", "20.50.1.2"] },
    });
  });

  it("reports a failed login without echoing the secret", async () => {
    const { http } = fakeHttp([
      ["https://login.microsoftonline.com/", () => res(401, { error: "invalid_client" })],
    ]);
    const err = await azure
      .fetchExport(
        { tenantId: TENANT, subscriptionId: SUB },
        { clientId: CLIENT, clientSecret: "super-secret-value" },
        { http },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(err.message).toMatch(/Azure login failed/);
    expect(err.message).not.toContain("super-secret-value");
  });

  it("validates config and secret shapes", () => {
    expect(azure.configSchema.safeParse({ tenantId: "x", subscriptionId: SUB }).success).toBe(
      false,
    );
    expect(azure.secretSchema.safeParse({ clientId: CLIENT, clientSecret: "short" }).success).toBe(
      false,
    );
    expect(azure.hint({ clientId: CLIENT, clientSecret: "abcdefgh9876" })).toBe("9876");
  });
});

describe("cloudflare provider", () => {
  it("lists zones (filtered) and all DNS pages", async () => {
    const { http, calls } = fakeHttp([
      [
        "https://api.cloudflare.com/client/v4/zones?",
        () =>
          res(200, {
            success: true,
            result: [
              { id: "z1", name: "example.com" },
              { id: "z2", name: "other.org" },
            ],
            result_info: { total_pages: 1 },
          }),
      ],
      [
        /zones\/z1\/dns_records\?.*page=1$/,
        () =>
          res(200, {
            success: true,
            result: [
              { name: "app.example.com", type: "A", content: "203.0.113.10", proxied: true },
            ],
            result_info: { total_pages: 2 },
          }),
      ],
      [
        /zones\/z1\/dns_records\?.*page=2$/,
        () =>
          res(200, {
            success: true,
            result: [
              { name: "www.example.com", type: "CNAME", content: "app.example.com", proxied: true },
            ],
            result_info: { total_pages: 2 },
          }),
      ],
    ]);
    const out = await cloudflare.fetchExport(
      { zones: "example.com", records: "all" },
      { apiToken: "cf_token_xxxxxxxxxxxxxxxx" },
      { http },
    );
    expect(calls.some((c) => c.url.includes("/zones/z2/"))).toBe(false);
    expect(calls[0]!.headers?.authorization).toBe("Bearer cf_token_xxxxxxxxxxxxxxxx");
    const data = JSON.parse(out.text) as { result: { name: string; zone_name: string }[] };
    expect(data.result.map((r) => [r.name, r.zone_name])).toEqual([
      ["app.example.com", "example.com"],
      ["www.example.com", "example.com"],
    ]);
  });

  it("surfaces API errors", async () => {
    const { http } = fakeHttp([
      [
        "https://api.cloudflare.com/",
        () => res(403, { success: false, errors: [{ message: "Invalid access token" }] }),
      ],
    ]);
    await expect(
      cloudflare.fetchExport(
        { records: "all" },
        { apiToken: "cf_token_xxxxxxxxxxxxxxxx" },
        { http },
      ),
    ).rejects.toThrow("Cloudflare API: Invalid access token");
  });
});

describe("cloudflare export parsing", () => {
  it("creates domains, exposes proxied ones through Cloudflare and links origins by IP", () => {
    const text = JSON.stringify({
      result: [
        { name: "app.example.com", type: "A", content: "203.0.113.10", proxied: true },
        { name: "www.example.com", type: "CNAME", content: "app.example.com", proxied: true },
        { name: "mail.example.com", type: "MX", content: "mx.example.com" },
        { name: "api.example.com", type: "A", content: "198.51.100.99", proxied: false },
      ],
    });
    const batch = parseImport(text, "json");
    expect(batch.format).toBe("cloudflare");
    expect(batch.resources.map((r) => [r.input.name, r.input.type])).toEqual([
      ["app.example.com", "DOMAIN"],
      ["www.example.com", "DOMAIN"],
      ["api.example.com", "DOMAIN"],
      ["Cloudflare", "EXTERNAL_SERVICE"],
    ]);
    const plan = planImport(
      batch,
      [
        {
          id: "r-app01",
          name: "APP01",
          type: "SERVER",
          source: "MANUAL",
          externalId: null,
          environment: null,
          criticality: null,
          description: null,
          notes: null,
          tags: [],
          metadata: { ipAddresses: ["203.0.113.10"] },
        },
      ],
      [],
    );
    expect(plan.errors).toEqual([]);
    expect(plan.relationships.map((r) => `${r.fromLabel} ${r.type} ${r.toLabel}`)).toEqual([
      "app.example.com EXPOSED_THROUGH Cloudflare",
      "app.example.com DEPENDS_ON APP01",
      "www.example.com EXPOSED_THROUGH Cloudflare",
      "www.example.com DEPENDS_ON app.example.com",
    ]);
    // Unknown origin IP is a warning, not an error.
    expect(plan.warnings.some((w) => w.includes("198.51.100.99"))).toBe(true);
  });
});

describe("aws provider", () => {
  it("paginates EC2 and RDS and maps SDK errors to a safe message", async () => {
    const pages: Record<string, unknown>[] = [
      {
        Reservations: [{ Instances: [{ InstanceId: "i-1", State: { Name: "running" } }] }],
        NextToken: "n1",
      },
      { Reservations: [{ Instances: [{ InstanceId: "i-2", State: { Name: "running" } }] }] },
    ];
    const out = await aws.fetchExport(
      { region: "eu-central-1" },
      { accessKeyId: "AKIAABCDEFGHIJKLMNOP", secretAccessKey: "x".repeat(40) },
      {
        http: async () => {
          throw new Error("no http for aws");
        },
        aws: () => ({
          describeInstances: async (token) => pages[token ? 1 : 0] as never,
          describeDbInstances: async () => ({ DBInstances: [{ DBInstanceIdentifier: "orders" }] }),
        }),
      },
    );
    const batch = parseImport(out.text, "json");
    expect(batch.resources.map((r) => r.key)).toEqual(["i-1", "i-2", "rds/orders"]);

    const failing = aws.fetchExport(
      { region: "eu-central-1" },
      { accessKeyId: "AKIAABCDEFGHIJKLMNOP", secretAccessKey: "x".repeat(40) },
      {
        http: async () => {
          throw new Error();
        },
        aws: () => ({
          describeInstances: async () => {
            throw Object.assign(new Error("secret details"), { name: "UnauthorizedOperation" });
          },
          describeDbInstances: async () => ({}),
        }),
      },
    );
    await expect(failing).rejects.toThrow(/AWS API: UnauthorizedOperation/);
    expect(aws.configSchema.safeParse({ region: "eu-central-1" }).success).toBe(true);
    expect(aws.configSchema.safeParse({ region: "https://evil" }).success).toBe(false);
  });
});

describe("cloudflare linked records", () => {
  const records = [
    { name: "inframole.com", type: "A", content: "146.59.154.3" },
    { name: "inframole.com", type: "AAAA", content: "2001:41d0:305:2100::1:7830" },
    { name: "www.inframole.com", type: "CNAME", content: "inframole.com" },
    { name: "alias.inframole.com", type: "CNAME", content: "www.inframole.com" },
    { name: "send.inframole.com", type: "CNAME", content: "send.forge.rmta.net" },
    { name: "dropmyway.com", type: "CNAME", content: "x.vercel-dns-017.com" },
    { name: "dev.spookops.com", type: "A", content: "93.189.89.137" },
  ];

  it("keeps only names that resolve to a known machine IP (through CNAME chains)", () => {
    expect(
      linkedRecords(records, new Set(["146.59.154.3"])).map((r) => `${r.name} ${r.type}`),
    ).toEqual([
      "inframole.com A",
      "inframole.com AAAA",
      "www.inframole.com CNAME",
      "alias.inframole.com CNAME",
    ]);
    expect(linkedRecords(records, new Set())).toEqual([]);
  });

  it("the provider filters with the workspace's IPs only in linked mode", async () => {
    const http: Http = async (url) =>
      res(200, {
        success: true,
        result: url.includes("dns_records") ? records : [{ id: "z1", name: "inframole.com" }],
        result_info: { total_pages: 1 },
      });
    const libraryIps = async () => new Set(["2001:41d0:305:2100::1:7830"]);
    const linked = await cloudflare.fetchExport(
      { records: "linked" },
      { apiToken: "cf_token_xxxxxxxxxxxxxxxx" },
      { http, libraryIps },
    );
    expect(JSON.parse(linked.text).result).toHaveLength(4);
    const all = await cloudflare.fetchExport(
      cloudflare.configSchema.parse({ zones: "" }),
      { apiToken: "cf_token_xxxxxxxxxxxxxxxx" },
      { http, libraryIps },
    );
    expect(JSON.parse(all.text).result).toHaveLength(records.length);
  });

  it("skips names with an underscore label (DKIM, SRV…)", () => {
    const batch = parseImport(
      JSON.stringify({
        result: [
          {
            name: "clk._domainkey.example.com",
            type: "CNAME",
            content: "dkim.x.com",
            proxied: false,
          },
          { name: "app.example.com", type: "A", content: "203.0.113.5", proxied: false },
        ],
      }),
      "cloudflare",
    );
    expect(batch.resources.map((r) => r.input.name)).toEqual(["app.example.com"]);
  });
});

describe("ip references", () => {
  it("resolve to the machine, never to a domain that points at the same IP", () => {
    const batch = parseImport(
      JSON.stringify({
        result: [{ name: "inframole.com", type: "A", content: "146.59.154.3", proxied: false }],
      }),
      "cloudflare",
    );
    const existing = [
      {
        id: "srv",
        name: "vps-1",
        type: "VM",
        source: "IMPORT",
        externalId: "cloud:ovhcloud/server/vps/vps-1",
        metadata: { ipAddresses: ["146.59.154.3"] },
        tags: [],
        environment: null,
        criticality: null,
        description: null,
        notes: null,
      },
      {
        id: "dom",
        name: "inframole.com",
        type: "DOMAIN",
        source: "IMPORT",
        externalId: "cloudflare:dns/inframole.com",
        metadata: { ipAddresses: ["146.59.154.3"] },
        tags: [],
        environment: null,
        criticality: null,
        description: null,
        notes: null,
      },
    ] as unknown as Parameters<typeof planImport>[1];
    const p = planImport(batch, existing, []);
    expect(p.warnings).toEqual([]);
    expect(p.relationships.map((r) => [r.fromLabel, r.type, r.toLabel])).toEqual([
      ["inframole.com", "DEPENDS_ON", "vps-1"],
    ]);
  });
});
