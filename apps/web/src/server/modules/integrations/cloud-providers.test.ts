// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M23 cloud providers against fixtures shaped like each provider's documented
 * API responses (Hetzner Cloud API, DigitalOcean API v2, Scaleway Instance /
 * Load Balancer / Managed Database APIs, OVHcloud API, Google Compute Engine
 * and Cloud SQL Admin, Clouding OpenAPI at api.clouding.io/swagger/v1).
 */
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseImport } from "@/server/modules/importers/parse";
import { planImport } from "@/server/modules/importers/plan";
import type { SafeResponse } from "@/server/safe-fetch";
import { IntegrationKind } from "@/generated/prisma/enums";
import { INTEGRATION_KINDS } from "@/lib/integration-forms";
import {
  clouding,
  digitalocean,
  googleAssertion,
  googleCloud,
  hetzner,
  ovhSignature,
  ovhcloud,
  scaleway,
} from "./cloud-providers";
import { IntegrationError, PROVIDERS, type Http } from "./providers";

const res = (status: number, body: unknown): SafeResponse => ({
  status,
  headers: new Headers(),
  text: typeof body === "string" ? body : JSON.stringify(body),
});

function fakeHttp(routes: [string | RegExp, (url: string, body?: string) => SafeResponse][]) {
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] =
    [];
  const http: Http = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const route = routes.find(([m]) => (typeof m === "string" ? url.startsWith(m) : m.test(url)));
    if (!route) throw new Error(`unexpected ${url}`);
    return route[1](url, init?.body);
  };
  return { http, calls };
}

const TOKEN = "t".repeat(64);

/** Runs the export through the real parser + planner (empty workspace). */
function plan(text: string) {
  const batch = parseImport(text, "cloud");
  expect(batch.errors).toEqual([]);
  return { batch, plan: planImport(batch, [], []) };
}

describe("hetzner", () => {
  it("imports servers and load balancers with their targets (label selectors expanded)", async () => {
    const { http, calls } = fakeHttp([
      [
        "https://api.hetzner.cloud/v1/servers?page=1",
        () =>
          res(200, {
            servers: [
              {
                id: 42,
                name: "web-1",
                status: "running",
                public_net: {
                  ipv4: { ip: "203.0.113.10" },
                  ipv6: { ip: "2001:db8:1::/64" },
                },
                private_net: [{ network: 7, ip: "10.0.0.2" }],
                server_type: { name: "cx22" },
                datacenter: { name: "fsn1-dc14", location: { name: "fsn1" } },
                image: { description: "Ubuntu 24.04", os_flavor: "ubuntu", os_version: "24.04" },
                labels: { env: "production", team: "web" },
              },
            ],
            meta: { pagination: { page: 1, next_page: 2, last_page: 2 } },
          }),
      ],
      [
        "https://api.hetzner.cloud/v1/servers?page=2",
        () =>
          res(200, {
            servers: [
              {
                id: 43,
                name: "web-2",
                status: "running",
                public_net: { ipv4: null, ipv6: null },
                private_net: [{ ip: "10.0.0.3" }],
                server_type: { name: "cx22" },
                datacenter: { location: { name: "fsn1" } },
                image: null,
                labels: {},
              },
            ],
            meta: { pagination: { page: 2, next_page: null, last_page: 2 } },
          }),
      ],
      [
        "https://api.hetzner.cloud/v1/load_balancers",
        () =>
          res(200, {
            load_balancers: [
              {
                id: 9,
                name: "lb-web",
                public_net: { ipv4: { ip: "203.0.113.99" }, ipv6: { ip: "2001:db8::99" } },
                private_net: [{ ip: "10.0.0.100" }],
                location: { name: "fsn1" },
                services: [{ listen_port: 443 }, { listen_port: 80 }],
                targets: [
                  { type: "server", server: { id: 42 } },
                  {
                    type: "label_selector",
                    label_selector: { selector: "team=web" },
                    targets: [{ type: "server", server: { id: 43 } }],
                  },
                ],
                labels: {},
              },
            ],
            meta: { pagination: { next_page: null } },
          }),
      ],
    ]);
    const out = await hetzner.fetchExport({}, { apiToken: TOKEN }, { http });
    expect(calls[0]!.headers?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls.every((c) => (c.method ?? "GET") === "GET")).toBe(true);

    const { batch, plan: p } = plan(out.text);
    const web1 = batch.resources.find((r) => r.input.name === "web-1")!;
    expect(web1.key).toBe("hetzner/server/42");
    expect(web1.input.type).toBe("VM");
    expect(web1.input.environment).toBe("PRODUCTION");
    expect(web1.input.metadata?.ipAddresses).toEqual(["203.0.113.10", "10.0.0.2"]); // no /64
    expect(web1.input.metadata?.os).toBe("Ubuntu 24.04");
    expect(web1.input.tags).toEqual(expect.arrayContaining(["hetzner", "team:web"]));
    const lb = batch.resources.find((r) => r.input.name === "lb-web")!;
    expect(lb.input.type).toBe("NETWORK");
    expect(lb.input.metadata?.ports).toEqual([80, 443]);
    expect(p.relationships.map((r) => [r.fromLabel, r.type, r.toLabel]).sort()).toEqual([
      ["web-1", "EXPOSED_THROUGH", "lb-web"],
      ["web-2", "EXPOSED_THROUGH", "lb-web"],
    ]);
  });

  it("still imports servers when the token cannot read load balancers", async () => {
    const { http } = fakeHttp([
      ["https://api.hetzner.cloud/v1/servers", () => res(200, { servers: [{ id: 1, name: "a" }] })],
      [
        "https://api.hetzner.cloud/v1/load_balancers",
        () => res(403, { error: { code: "forbidden", message: "insufficient permissions" } }),
      ],
    ]);
    const out = await hetzner.fetchExport({}, { apiToken: TOKEN }, { http });
    expect(JSON.parse(out.text)).toMatchObject({ servers: [{ id: "1" }], loadBalancers: [] });
  });

  it("reports a rejected token without echoing it", async () => {
    const { http } = fakeHttp([
      [
        "https://api.hetzner.cloud/",
        () => res(401, { error: { code: "unauthorized", message: "unable to authenticate" } }),
      ],
    ]);
    const err = await hetzner.fetchExport({}, { apiToken: TOKEN }, { http }).catch((e) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(String(err.message)).not.toContain(TOKEN);
  });
});

describe("digitalocean", () => {
  it("imports droplets, load balancers and managed databases", async () => {
    const { http, calls } = fakeHttp([
      [
        "https://api.digitalocean.com/v2/droplets",
        () =>
          res(200, {
            droplets: [
              {
                id: 3164444,
                name: "app-01",
                status: "active",
                size_slug: "s-2vcpu-4gb",
                region: { slug: "ams3" },
                image: { distribution: "Ubuntu", name: "24.04 (LTS) x64" },
                networks: {
                  v4: [
                    { ip_address: "10.110.0.2", type: "private" },
                    { ip_address: "198.51.100.7", type: "public" },
                  ],
                  v6: [],
                },
                tags: ["env:staging", "web"],
              },
            ],
            links: {},
            meta: { total: 1 },
          }),
      ],
      [
        "https://api.digitalocean.com/v2/load_balancers",
        () =>
          res(200, {
            load_balancers: [
              {
                id: "4de7ac8b-495b-4884-9a69-1050c6793cd6",
                name: "lb-app",
                ip: "198.51.100.200",
                region: { slug: "ams3" },
                droplet_ids: [3164444, 999],
                forwarding_rules: [{ entry_port: 443, target_port: 8080 }],
              },
            ],
            links: {},
          }),
      ],
      [
        "https://api.digitalocean.com/v2/databases",
        () =>
          res(200, {
            databases: [
              {
                id: "9cc10173-e9ea-4176-9dbc-a4cee4c4ff30",
                name: "db-main",
                engine: "pg",
                version: "16",
                region: "ams3",
                size: "db-s-1vcpu-1gb",
                connection: { host: "db-main-do-user-1.db.ondigitalocean.com", port: 25060 },
                private_connection: { host: "private-db-main-do-user-1.db.ondigitalocean.com" },
                tags: null,
              },
            ],
          }),
      ],
    ]);
    const out = await digitalocean.fetchExport({}, { apiToken: TOKEN }, { http });
    expect(calls[0]!.url).toContain("per_page=200&page=1");
    const { batch, plan: p } = plan(out.text);
    const app = batch.resources.find((r) => r.key === "digitalocean/server/3164444")!;
    expect(app.input.environment).toBe("STAGING");
    expect(app.input.metadata?.ipAddresses).toEqual(["10.110.0.2", "198.51.100.7"]);
    const db = batch.resources.find((r) => r.input.name === "db-main")!;
    expect(db.input.type).toBe("DATABASE");
    expect(db.input.description).toContain("managed PostgreSQL");
    expect(db.input.metadata?.hostname).toBe("private-db-main-do-user-1.db.ondigitalocean.com");
    expect(db.input.metadata?.ports).toEqual([25060]);
    // Droplet 999 is not in the inventory: no dangling relationship.
    expect(p.relationships.map((r) => [r.fromLabel, r.toLabel])).toEqual([["app-01", "lb-app"]]);
  });
});

describe("scaleway", () => {
  it("lists every zone with the right page parameters and maps LB backend IPs", async () => {
    const { http, calls } = fakeHttp([
      [
        /instance\/v1\/zones\/fr-par-1\/servers/,
        () =>
          res(200, {
            servers: [
              {
                id: "11111111-2222-3333-4444-555555555555",
                name: "scw-web",
                hostname: "scw-web",
                commercial_type: "DEV1-S",
                state: "running",
                zone: "fr-par-1",
                public_ips: [{ address: "51.15.0.1" }],
                public_ip: { address: "51.15.0.1" },
                private_ip: null,
                image: { name: "Debian Bookworm" },
                tags: [],
              },
            ],
          }),
      ],
      [/instance\/v1\/zones\/nl-ams-1\/servers/, () => res(200, { servers: [] })],
      [
        /lb\/v1\/zones\/fr-par-1\/lbs\?/,
        () =>
          res(200, {
            lbs: [
              { id: "lb-1", name: "scw-lb", zone: "fr-par-1", ip: [{ ip_address: "51.15.9.9" }] },
            ],
            total_count: 1,
          }),
      ],
      [
        /lbs\/lb-1\/backends/,
        () => res(200, { backends: [{ pool: ["51.15.0.1"] }], total_count: 1 }),
      ],
      [
        /lbs\/lb-1\/frontends/,
        () => res(200, { frontends: [{ inbound_port: 443 }], total_count: 1 }),
      ],
      [/lb\/v1\/zones\/nl-ams-1\/lbs/, () => res(403, { message: "permission denied" })],
      [
        /rdb\/v1\/regions\/fr-par\/instances/,
        () =>
          res(200, {
            instances: [
              {
                id: "db-1",
                name: "scw-pg",
                engine: "PostgreSQL-15",
                region: "fr-par",
                node_type: "db-dev-s",
                endpoints: [{ ip: "51.15.5.5", port: 5432 }],
                tags: [],
              },
            ],
            total_count: 1,
          }),
      ],
      [/rdb\/v1\/regions\/nl-ams\/instances/, () => res(200, { instances: [], total_count: 0 })],
    ]);
    const config = scaleway.configSchema.parse({ zones: "fr-par-1, NL-AMS-1" });
    const out = await scaleway.fetchExport(
      config,
      { secretKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      { http },
    );
    expect(calls[0]!.headers?.["x-auth-token"]).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(calls.find((c) => c.url.includes("/servers"))!.url).toContain("per_page=100");
    expect(calls.find((c) => c.url.includes("/lbs?"))!.url).toContain("page_size=100");
    const inv = JSON.parse(out.text);
    expect(inv.loadBalancers[0]).toMatchObject({ ports: [443], targets: [{ ip: "51.15.0.1" }] });
    expect(inv.databases[0]).toMatchObject({ engine: "PostgreSQL", version: "15", port: 5432 });
    expect(inv.servers[0].ips).toEqual(["51.15.0.1"]);
  });

  it("validates zones and keeps the config re-parsable", () => {
    expect(scaleway.configSchema.safeParse({ zones: "paris" }).success).toBe(false);
    const once = scaleway.configSchema.parse({ zones: " fr-par-1 " });
    expect(scaleway.configSchema.parse(once)).toEqual(once);
  });
});

describe("ovhcloud", () => {
  it("signs every request and imports instances and dedicated servers", async () => {
    const { http, calls } = fakeHttp([
      ["https://eu.api.ovh.com/1.0/auth/time", () => res(200, "1700000000")],
      ["https://eu.api.ovh.com/1.0/cloud/project/", () => res(200, [])],
      [
        "https://eu.api.ovh.com/1.0/cloud/project",
        () => res(200, ["0123456789abcdef0123456789abcdef"]),
      ],
      [
        "https://eu.api.ovh.com/1.0/dedicated/server/",
        () =>
          res(200, {
            name: "ns1234.ip-1-2-3.eu",
            ip: "1.2.3.4",
            reverse: "backup.example.com.",
            os: "debian12_64",
            datacenter: "gra3",
            state: "ok",
            commercialRange: "rise",
          }),
      ],
      ["https://eu.api.ovh.com/1.0/dedicated/server", () => res(200, ["ns1234.ip-1-2-3.eu"])],
      [
        "https://eu.api.ovh.com/1.0/vps/vps-abc123.vps.ovh.net/ips",
        () => res(200, ["146.59.154.3", "2001:41d0:305:2100::1:7830"]),
      ],
      [
        "https://eu.api.ovh.com/1.0/vps/vps-abc123.vps.ovh.net",
        () =>
          res(200, {
            name: "vps-abc123.vps.ovh.net",
            displayName: "im-web-01",
            zone: "Region OpenStack: os-gra9",
            state: "running",
            model: { name: "vps-2025-model1", vcore: 2, memory: 4096 },
          }),
      ],
      ["https://eu.api.ovh.com/1.0/vps", () => res(200, ["vps-abc123.vps.ovh.net"])],
    ]);
    const secret = {
      applicationKey: "appkey12345",
      applicationSecret: "appsecret1234567890",
      consumerKey: "consumer1234567890",
    };
    const out = await ovhcloud.fetchExport(
      ovhcloud.configSchema.parse({ endpoint: "ovh-eu", projectId: "" }),
      secret,
      { http },
    );
    const signed = calls.filter((c) => c.headers?.["x-ovh-signature"]);
    expect(signed.length).toBe(calls.length - 1); // all but /auth/time
    for (const c of signed) {
      expect(c.headers!["x-ovh-signature"]).toBe(
        ovhSignature(
          secret.applicationSecret,
          secret.consumerKey,
          "GET",
          c.url,
          "",
          Number(c.headers!["x-ovh-timestamp"]),
        ),
      );
    }
    const inv = JSON.parse(out.text);
    expect(inv.servers).toEqual([
      expect.objectContaining({
        id: "vps/vps-abc123.vps.ovh.net",
        name: "im-web-01",
        hostname: "vps-abc123.vps.ovh.net",
        region: "os-gra9",
        size: "2 vCores / 4 GB RAM",
        ips: ["146.59.154.3", "2001:41d0:305:2100::1:7830"],
      }),
      expect.objectContaining({
        id: "dedicated/ns1234.ip-1-2-3.eu",
        name: "backup.example.com",
        kind: "SERVER",
        ips: ["1.2.3.4"],
      }),
    ]);
    const { batch } = plan(out.text);
    expect(batch.resources.map((r) => r.input.type)).toEqual(["VM", "SERVER"]);
  });

  it("computes the documented signature", () => {
    // "$1$" + sha1("AS+CK+GET+https://eu.api.ovh.com/1.0/me++1700000000")
    expect(ovhSignature("AS", "CK", "GET", "https://eu.api.ovh.com/1.0/me", "", 1700000000)).toBe(
      "$1$" +
        createHash("sha1")
          .update("AS+CK+GET+https://eu.api.ovh.com/1.0/me++1700000000")
          .digest("hex"),
    );
  });
});

describe("google cloud", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    type: "service_account",
    project_id: "acme-prod-123",
    private_key_id: "abcdef0123456789",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "inframole@acme-prod-123.iam.gserviceaccount.com",
  };

  it("builds a verifiable RS256 assertion with the read-only scope", () => {
    const jwt = googleAssertion(key, 1700000000);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims).toMatchObject({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform.read-only",
      aud: "https://oauth2.googleapis.com/token",
      exp: 1700000600,
    });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
  });

  it("accepts the pasted JSON and the stored object alike", () => {
    const pasted = googleCloud.secretSchema.parse({ serviceAccountKey: JSON.stringify(key) });
    expect(googleCloud.secretSchema.parse(pasted)).toEqual(pasted);
    expect(googleCloud.secretSchema.safeParse({ serviceAccountKey: "not json" }).success).toBe(
      false,
    );
  });

  it("imports Compute Engine instances and Cloud SQL (optional)", async () => {
    const { http, calls } = fakeHttp([
      ["https://oauth2.googleapis.com/token", () => res(200, { access_token: "ya29.x" })],
      [
        "https://compute.googleapis.com/compute/v1/projects/acme-prod-123/aggregated/instances",
        (url) =>
          url.includes("pageToken")
            ? res(200, {
                items: { "zones/us-east1-b": { warning: { code: "NO_RESULTS_ON_PAGE" } } },
              })
            : res(200, {
                items: {
                  "zones/europe-west1-b": {
                    instances: [
                      {
                        id: "1234567890123",
                        name: "gce-api",
                        status: "RUNNING",
                        zone: "https://www.googleapis.com/compute/v1/projects/acme-prod-123/zones/europe-west1-b",
                        machineType:
                          "https://www.googleapis.com/compute/v1/projects/acme-prod-123/zones/europe-west1-b/machineTypes/e2-medium",
                        networkInterfaces: [
                          { networkIP: "10.132.0.5", accessConfigs: [{ natIP: "34.76.1.2" }] },
                        ],
                        labels: { environment: "production" },
                        disks: [
                          {
                            boot: true,
                            licenses: [
                              "https://www.googleapis.com/compute/v1/projects/debian-cloud/global/licenses/debian-12-bookworm",
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
                nextPageToken: "p2",
              }),
      ],
      [
        "https://sqladmin.googleapis.com/",
        () =>
          res(403, {
            error: { code: 403, message: "Cloud SQL Admin API has not been used in project" },
          }),
      ],
    ]);
    const secret = googleCloud.secretSchema.parse({ serviceAccountKey: JSON.stringify(key) });
    const out = await googleCloud.fetchExport({ projectId: "" }, secret, { http });
    expect(calls[0]!.body).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
    );
    expect(calls[1]!.headers?.authorization).toBe("Bearer ya29.x");
    const { batch } = plan(out.text);
    expect(batch.resources).toHaveLength(1);
    expect(batch.resources[0]!.input).toMatchObject({
      name: "gce-api",
      environment: "PRODUCTION",
      description: "Google Cloud · e2-medium · europe-west1-b · RUNNING",
    });
    expect(batch.resources[0]!.input.metadata).toMatchObject({
      os: "debian-12-bookworm",
      ipAddresses: ["10.132.0.5", "34.76.1.2"],
    });
  });

  it("never sends the key to a token endpoint taken from the key file", async () => {
    const { http, calls } = fakeHttp([
      ["https://oauth2.googleapis.com/token", () => res(400, { error: "invalid_grant" })],
    ]);
    const secret = googleCloud.secretSchema.parse({
      serviceAccountKey: JSON.stringify({ ...key, token_uri: "https://evil.example/token" }),
    });
    await expect(googleCloud.fetchExport({}, secret, { http })).rejects.toThrow(/login failed/);
    expect(calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token"]);
  });
});

describe("clouding", () => {
  it("imports servers as documented in the Clouding OpenAPI", async () => {
    const { http, calls } = fakeHttp([
      [
        "https://api.clouding.io/v1/servers?page=1",
        () =>
          res(200, {
            servers: [
              {
                id: "wJLB82xyPWOrqeN6",
                name: "web-server",
                hostname: "web.example.com",
                vCores: 1,
                ramGb: 2,
                flavor: "1x2",
                volumeSizeGb: 10,
                image: { id: "lo1qJ9oZb1xGMEgD", name: "Ubuntu 24.04 (64 Bit)" },
                status: "Active",
                powerState: "Running",
                features: ["PrivateNetwork"],
                dnsAddress: "e9feeaf6.clouding.host",
                publicIp: "185.254.254.189",
                publicPorts: [{ id: "a", ipAddress: "185.254.254.189", macAddress: "x" }],
                privateIp: "10.20.10.2",
                vpcPorts: [{ id: "b", ipAddress: "10.20.10.2", macAddress: "y", vpc: {} }],
              },
            ],
            links: {
              next: "https://api.clouding.io/v1/servers?page=2&pageSize=200",
              previous: null,
            },
            meta: { total: 2 },
          }),
      ],
      [
        "https://api.clouding.io/v1/servers?page=2",
        () =>
          res(200, {
            servers: [{ id: "ke8vlrXPjxO1oq3m", name: "db-server", status: "Active" }],
            links: { next: null },
            meta: { total: 2 },
          }),
      ],
    ]);
    const out = await clouding.fetchExport({}, { apiKey: "k".repeat(40) }, { http });
    expect(calls[0]!.headers?.["x-api-key"]).toBe("k".repeat(40));
    const { batch } = plan(out.text);
    expect(batch.resources.map((r) => r.key)).toEqual([
      "clouding/server/wjlb82xypworqen6",
      "clouding/server/ke8vlrxpjxo1oq3m",
    ]);
    expect(batch.resources[0]!.input.metadata).toMatchObject({
      hostname: "web.example.com",
      os: "Ubuntu 24.04 (64 Bit)",
      ipAddresses: ["185.254.254.189", "10.20.10.2"],
    });
    expect(batch.resources[0]!.input.description).toBe("Clouding · 1 vCores / 2 GB RAM · Running");
  });
});

describe("registry", () => {
  it("has a provider for every integration kind", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(Object.values(IntegrationKind).sort());
    expect([...INTEGRATION_KINDS].sort()).toEqual(Object.values(IntegrationKind).sort());
  });
});
