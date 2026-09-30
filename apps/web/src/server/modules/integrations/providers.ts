// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration providers (ADR-018 D). Each one turns read-only API calls into
 * the SAME JSON shape as the platform's CLI export, so the importer pipeline
 * (parse-platforms.ts → plan.ts → apply) is shared with option A.
 *
 * All HTTP goes through `deps.http` (safeFetch in production: https only,
 * public destinations, no redirects). AWS uses the official SDK against the
 * fixed regional AWS endpoints (region validated by pattern).
 */
import { z } from "zod";
import {
  IntegrationError,
  json,
  last4,
  uuid,
  type AwsApi,
  type Http,
  type Provider,
} from "./provider-base";
import {
  clouding,
  digitalocean,
  googleCloud,
  hetzner,
  ovhcloud,
  scaleway,
} from "./cloud-providers";

export * from "./provider-base";

// ───────────────────────── Azure ─────────────────────────

const azureConfig = z.object({ tenantId: uuid, subscriptionId: uuid });
const azureSecret = z.object({ clientId: uuid, clientSecret: z.string().min(8).max(512) });

const ARM = "https://management.azure.com";

async function armList(
  http: Http,
  token: string,
  path: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let url: string | undefined = `${ARM}${path}`;
  for (let page = 0; url && page < 50; page++) {
    const res = await http(url, { headers: { authorization: `Bearer ${token}` } });
    const body = await json(res, "Azure");
    if (res.status !== 200) {
      const msg = (body.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
      throw new IntegrationError(`Azure API: ${msg.slice(0, 200)}`);
    }
    items.push(...((body.value as Record<string, unknown>[]) ?? []));
    const next = body.nextLink as string | undefined;
    url = next && next.startsWith(`${ARM}/`) ? next : undefined; // never follow foreign hosts
  }
  return items;
}

export const azure: Provider<z.infer<typeof azureConfig>, z.infer<typeof azureSecret>> = {
  configSchema: azureConfig,
  secretSchema: azureSecret,
  hint: (s) => last4(s.clientSecret),
  async fetchExport(config, secret, { http }) {
    const tokenRes = await http(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: secret.clientId,
          client_secret: secret.clientSecret,
          scope: `${ARM}/.default`,
        }).toString(),
      },
    );
    const tokenBody = await json(tokenRes, "Azure login");
    if (tokenRes.status !== 200 || typeof tokenBody.access_token !== "string") {
      throw new IntegrationError(
        "Azure login failed — check the tenant ID, client ID and client secret.",
      );
    }
    const token = tokenBody.access_token;
    const sub = `/subscriptions/${config.subscriptionId}`;
    const [vms, nics, pips] = await Promise.all([
      armList(
        http,
        token,
        `${sub}/providers/Microsoft.Compute/virtualMachines?api-version=2024-07-01`,
      ),
      armList(
        http,
        token,
        `${sub}/providers/Microsoft.Network/networkInterfaces?api-version=2024-05-01`,
      ),
      armList(
        http,
        token,
        `${sub}/providers/Microsoft.Network/publicIPAddresses?api-version=2024-05-01`,
      ),
    ]);
    type IpConfig = {
      properties?: { privateIPAddress?: string; publicIPAddress?: { id?: string } };
    };
    const publicById = new Map(
      pips.map((p) => [
        String(p.id).toLowerCase(),
        (p.properties as { ipAddress?: string })?.ipAddress,
      ]),
    );
    const nicById = new Map(
      nics.map((n) => {
        const configs = (n.properties as { ipConfigurations?: IpConfig[] })?.ipConfigurations ?? [];
        return [
          String(n.id).toLowerCase(),
          {
            private: configs.map((c) => c.properties?.privateIPAddress).filter(Boolean) as string[],
            public: configs
              .map((c) => publicById.get(String(c.properties?.publicIPAddress?.id).toLowerCase()))
              .filter(Boolean) as string[],
          },
        ];
      }),
    );
    // Same shape as `az vm list -d` (see parse-platforms.ts).
    const shaped = vms.map((vm) => {
      const props = (vm.properties ?? {}) as {
        hardwareProfile?: unknown;
        storageProfile?: unknown;
        networkProfile?: { networkInterfaces?: { id: string }[] };
      };
      const nicIps = (props.networkProfile?.networkInterfaces ?? []).map((n) =>
        nicById.get(n.id.toLowerCase()),
      );
      return {
        id: vm.id,
        name: vm.name,
        resourceGroup: String(vm.id).split("/")[4],
        location: vm.location,
        hardwareProfile: props.hardwareProfile,
        storageProfile: props.storageProfile,
        tags: vm.tags ?? {},
        privateIps: nicIps.flatMap((n) => n?.private ?? []).join(","),
        publicIps: nicIps.flatMap((n) => n?.public ?? []).join(","),
      };
    });
    return { format: "azure", text: JSON.stringify(shaped) };
  },
};

// ───────────────────────── AWS ─────────────────────────

const awsConfig = z.object({
  region: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d$/, "e.g. eu-central-1"),
});
const awsSecret = z.object({
  accessKeyId: z
    .string()
    .trim()
    .regex(/^(AKIA|ASIA)[A-Z0-9]{12,}$/, "Looks like AKIA…"),
  secretAccessKey: z.string().trim().min(20).max(128),
});

async function defaultAws(
  region: string,
  credentials: { accessKeyId: string; secretAccessKey: string },
): Promise<AwsApi> {
  const [{ EC2Client, DescribeInstancesCommand }, { RDSClient, DescribeDBInstancesCommand }] =
    await Promise.all([import("@aws-sdk/client-ec2"), import("@aws-sdk/client-rds")]);
  const opts = { region, credentials, maxAttempts: 2 };
  const ec2 = new EC2Client(opts);
  const rds = new RDSClient(opts);
  return {
    describeInstances: (NextToken) =>
      ec2.send(new DescribeInstancesCommand({ NextToken, MaxResults: 1000 })),
    describeDbInstances: (Marker) =>
      rds.send(new DescribeDBInstancesCommand({ Marker, MaxRecords: 100 })),
  };
}

export const aws: Provider<z.infer<typeof awsConfig>, z.infer<typeof awsSecret>> = {
  configSchema: awsConfig,
  secretSchema: awsSecret,
  hint: (s) => last4(s.accessKeyId),
  async fetchExport(config, secret, deps) {
    const api = deps.aws
      ? deps.aws(config.region, secret)
      : await defaultAws(config.region, secret);
    try {
      const Reservations: unknown[] = [];
      let next: string | undefined;
      for (let page = 0; page < 20; page++) {
        const out = await api.describeInstances(next);
        Reservations.push(...(out.Reservations ?? []));
        if (!(next = out.NextToken)) break;
      }
      const DBInstances: unknown[] = [];
      let marker: string | undefined;
      for (let page = 0; page < 20; page++) {
        const out = await api.describeDbInstances(marker);
        DBInstances.push(...(out.DBInstances ?? []));
        if (!(marker = out.Marker)) break;
      }
      return { format: "aws", text: JSON.stringify({ Reservations, DBInstances }) };
    } catch (error) {
      const name = (error as { name?: string }).name ?? "Error";
      throw new IntegrationError(
        `AWS API: ${name} — check the region and that the key allows ec2:DescribeInstances and rds:DescribeDBInstances.`,
      );
    }
  },
};

// ───────────────────────── Cloudflare ─────────────────────────

const cfConfig = z.object({
  /** Optional comma-separated zone names to include (empty = all zones the token can read). */
  zones: z.string().trim().max(500).optional(),
  /**
   * "linked": only records that point (directly or through CNAMEs) to an IP of
   * a resource already in the Library. Integrations created before this
   * option have no value and keep importing everything.
   */
  records: z.enum(["linked", "all"]).default("all"),
});

interface CfApiRecord {
  name: string;
  type: string;
  content: string;
}

/** Records whose name resolves, directly or through CNAMEs, to one of `ips`. */
export function linkedRecords<R extends CfApiRecord>(records: R[], ips: Set<string>): R[] {
  const keep = new Set<string>();
  for (const r of records)
    if ((r.type === "A" || r.type === "AAAA") && ips.has(r.content.toLowerCase()))
      keep.add(r.name.toLowerCase());
  for (let changed = true; changed;) {
    changed = false;
    for (const r of records) {
      const name = r.name.toLowerCase();
      if (r.type === "CNAME" && !keep.has(name) && keep.has(r.content.toLowerCase())) {
        keep.add(name);
        changed = true;
      }
    }
  }
  return records.filter((r) => keep.has(r.name.toLowerCase()));
}
const cfSecret = z.object({ apiToken: z.string().trim().min(20).max(200) });
const CF = "https://api.cloudflare.com/client/v4";

export const cloudflare: Provider<z.infer<typeof cfConfig>, z.infer<typeof cfSecret>> = {
  configSchema: cfConfig,
  secretSchema: cfSecret,
  hint: (s) => last4(s.apiToken),
  async fetchExport(config, secret, { http, libraryIps }) {
    const headers = { authorization: `Bearer ${secret.apiToken}` };
    const get = async (path: string) => {
      const res = await http(`${CF}${path}`, { headers });
      const body = await json(res, "Cloudflare");
      if (res.status !== 200 || body.success === false) {
        const msg =
          (body.errors as { message?: string }[] | undefined)?.[0]?.message ?? `HTTP ${res.status}`;
        throw new IntegrationError(`Cloudflare API: ${msg.slice(0, 200)}`);
      }
      return body as { result: Record<string, unknown>[]; result_info?: { total_pages?: number } };
    };
    const wanted = new Set(
      (config.zones ?? "")
        .split(",")
        .map((z) => z.trim().toLowerCase())
        .filter(Boolean),
    );
    const zones: { id: string; name: string }[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = await get(`/zones?per_page=50&page=${page}`);
      zones.push(...(body.result as { id: string; name: string }[]));
      if (page >= (body.result_info?.total_pages ?? 1)) break;
    }
    const selected = zones
      .filter((z) => wanted.size === 0 || wanted.has(z.name.toLowerCase()))
      .slice(0, 50);
    const result: Record<string, unknown>[] = [];
    for (const zone of selected) {
      for (let page = 1; page <= 20; page++) {
        const body = await get(
          `/zones/${encodeURIComponent(zone.id)}/dns_records?per_page=500&page=${page}`,
        );
        result.push(...body.result.map((r) => ({ ...r, zone_name: zone.name })));
        if (page >= (body.result_info?.total_pages ?? 1)) break;
      }
    }
    const kept =
      config.records === "linked"
        ? linkedRecords(result as unknown as CfApiRecord[], (await libraryIps?.()) ?? new Set())
        : result;
    return { format: "cloudflare", text: JSON.stringify({ result: kept }) };
  },
};

export const PROVIDERS = {
  AZURE: azure,
  AWS: aws,
  CLOUDFLARE: cloudflare,
  HETZNER: hetzner,
  DIGITALOCEAN: digitalocean,
  SCALEWAY: scaleway,
  OVHCLOUD: ovhcloud,
  GOOGLE_CLOUD: googleCloud,
  CLOUDING: clouding,
} as const;
export type ProviderKind = keyof typeof PROVIDERS;
