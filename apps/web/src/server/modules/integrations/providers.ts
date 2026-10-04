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
import type {
  CloudDatabase,
  CloudLoadBalancer,
  DnsRecord,
} from "@/server/modules/importers/parse-platforms";
import {
  DNS_LIMITS,
  IntegrationError,
  dnsMode,
  json,
  last4,
  linkedRecords,
  mapLimit,
  selectDns,
  strings,
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
import { ionos, linode, oracleCloud, vultr } from "./more-clouds";
import { tailscale } from "./tailscale";
import { netbox, prtg, zabbix } from "./other-tools";
import { proxmox, synology, truenas } from "./local-sources";

export * from "./provider-base";

// ───────────────────────── Azure ─────────────────────────

const azureConfig = z.object({ tenantId: uuid, subscriptionId: uuid, dns: dnsMode });
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

/**
 * Sections added in M27 (load balancers, managed databases): a resource
 * provider that is not registered on the subscription, or any other refusal,
 * leaves the section empty instead of failing the sync.
 */
async function armOptional(http: Http, token: string, path: string) {
  try {
    return await armList(http, token, path);
  } catch (error) {
    if (error instanceof IntegrationError) return [];
    throw error;
  }
}

type ArmItem = Record<string, unknown> & {
  id?: string;
  name?: string;
  location?: string;
  tags?: Record<string, string> | null;
  sku?: { name?: string };
  properties?: Record<string, unknown>;
};

const lower = (s: unknown) => String(s ?? "").toLowerCase();
/** ".../networkInterfaces/nic1/ipConfigurations/ipconfig1" → ".../networkinterfaces/nic1". */
const nicOf = (ipConfigId: unknown) => lower(ipConfigId).replace(/\/ipconfigurations\/[^/]+$/, "");

/** Azure DNS record set → records (alias records to a public IP resolve to that IP). */
function azureRecords(
  set: ArmItem,
  zone: string,
  publicIpById: Map<string, string | undefined>,
): DnsRecord[] {
  const p = (set.properties ?? {}) as {
    fqdn?: string;
    ARecords?: { ipv4Address?: string }[];
    AAAARecords?: { ipv6Address?: string }[];
    CNAMERecord?: { cname?: string };
    targetResource?: { id?: string };
  };
  const name = (p.fqdn ?? `${set.name}.${zone}`).replace(/\.$/, "");
  const type = lower(set.type).split("/").pop()?.toUpperCase() ?? "";
  const records: DnsRecord[] = [];
  for (const a of p.ARecords ?? [])
    if (a.ipv4Address) records.push({ name, type: "A", content: a.ipv4Address, zone });
  for (const a of p.AAAARecords ?? [])
    if (a.ipv6Address) records.push({ name, type: "AAAA", content: a.ipv6Address, zone });
  if (p.CNAMERecord?.cname)
    records.push({ name, type: "CNAME", content: p.CNAMERecord.cname, zone });
  const alias = p.targetResource?.id ? publicIpById.get(lower(p.targetResource.id)) : undefined;
  if (alias && (type === "A" || type === "AAAA") && records.length === 0)
    records.push({ name, type, content: alias, zone });
  return records;
}

export const azure: Provider<z.infer<typeof azureConfig>, z.infer<typeof azureSecret>> = {
  configSchema: azureConfig,
  secretSchema: azureSecret,
  hint: (s) => last4(s.clientSecret),
  async fetchExport(config, secret, deps) {
    const { http } = deps;
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
    const net = (type: string) =>
      `${sub}/providers/Microsoft.Network/${type}?api-version=2024-05-01`;
    const [vms, nics, pips, lbs, gateways, sqlServers, postgres, mysql] = (await Promise.all([
      armList(
        http,
        token,
        `${sub}/providers/Microsoft.Compute/virtualMachines?api-version=2024-07-01`,
      ),
      armList(http, token, net("networkInterfaces")),
      armList(http, token, net("publicIPAddresses")),
      armOptional(http, token, net("loadBalancers")),
      armOptional(http, token, net("applicationGateways")),
      armOptional(http, token, `${sub}/providers/Microsoft.Sql/servers?api-version=2023-08-01`),
      armOptional(
        http,
        token,
        `${sub}/providers/Microsoft.DBforPostgreSQL/flexibleServers?api-version=2024-08-01`,
      ),
      armOptional(
        http,
        token,
        `${sub}/providers/Microsoft.DBforMySQL/flexibleServers?api-version=2023-12-30`,
      ),
    ])) as [ArmItem[], ArmItem[], ArmItem[], ArmItem[], ArmItem[], ArmItem[], ArmItem[], ArmItem[]];
    type IpConfig = {
      id?: string;
      properties?: { privateIPAddress?: string; publicIPAddress?: { id?: string } };
    };
    const publicById = new Map(
      pips.map((p) => [lower(p.id), (p.properties as { ipAddress?: string })?.ipAddress]),
    );
    const nicById = new Map(
      nics.map((n) => {
        const props = (n.properties ?? {}) as {
          ipConfigurations?: IpConfig[];
          virtualMachine?: { id?: string };
        };
        const configs = props.ipConfigurations ?? [];
        return [
          lower(n.id),
          {
            vm: props.virtualMachine?.id ? lower(props.virtualMachine.id) : undefined,
            private: configs.map((c) => c.properties?.privateIPAddress).filter(Boolean) as string[],
            public: configs
              .map((c) => publicById.get(lower(c.properties?.publicIPAddress?.id)))
              .filter(Boolean) as string[],
          },
        ];
      }),
    );
    // Same shape as `az vm list -d` (see parse-platforms.ts).
    const virtualMachines = vms.map((vm) => {
      const props = (vm.properties ?? {}) as {
        hardwareProfile?: unknown;
        storageProfile?: unknown;
        networkProfile?: { networkInterfaces?: { id: string }[] };
      };
      const nicIps = (props.networkProfile?.networkInterfaces ?? []).map((n) =>
        nicById.get(lower(n.id)),
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

    // Load Balancers and Application Gateways with their backends.
    type FrontendIp = {
      properties?: { privateIPAddress?: string; publicIPAddress?: { id?: string } };
    };
    type Pool = {
      properties?: {
        backendIPConfigurations?: { id?: string }[];
        loadBalancerBackendAddresses?: { properties?: { ipAddress?: string } }[];
        backendAddresses?: { ipAddress?: string; fqdn?: string }[];
      };
    };
    const frontends = (p: Record<string, unknown>) =>
      ((p.frontendIPConfigurations as FrontendIp[] | undefined) ?? []).flatMap((f) => [
        f.properties?.privateIPAddress,
        publicById.get(lower(f.properties?.publicIPAddress?.id)),
      ]);
    const backends = (p: Record<string, unknown>) =>
      ((p.backendAddressPools as Pool[] | undefined) ?? []).flatMap((pool) => [
        ...(pool.properties?.backendIPConfigurations ?? []).map((c) => {
          const vm = nicById.get(nicOf(c.id))?.vm;
          return vm ? { server: vm } : {};
        }),
        ...(pool.properties?.loadBalancerBackendAddresses ?? []).map((a) => ({
          ip: a.properties?.ipAddress,
        })),
        ...(pool.properties?.backendAddresses ?? []).map((a) =>
          a.ipAddress ? { ip: a.ipAddress } : { host: a.fqdn },
        ),
      ]);
    const loadBalancers: CloudLoadBalancer[] = [
      ...lbs.map((lb) => {
        const p = lb.properties ?? {};
        return {
          id: String(lb.id),
          name: String(lb.name),
          kind: "Azure Load Balancer",
          region: lb.location,
          ips: strings(frontends(p)),
          ports: ((p.loadBalancingRules as { properties?: { frontendPort?: number } }[]) ?? [])
            .map((r) => r.properties?.frontendPort)
            .filter((n): n is number => !!n),
          targets: backends(p),
          labels: lb.tags ?? {},
        };
      }),
      ...gateways.map((gw) => {
        const p = gw.properties ?? {};
        return {
          id: String(gw.id),
          name: String(gw.name),
          kind: "Azure Application Gateway",
          region: gw.location,
          ips: strings(frontends(p)),
          ports: ((p.frontendPorts as { properties?: { port?: number } }[]) ?? [])
            .map((f) => f.properties?.port)
            .filter((n): n is number => !!n),
          targets: backends(p),
          labels: gw.tags ?? {},
        };
      }),
    ];

    // Managed databases: Azure SQL databases (per server) and flexible servers.
    const sqlDatabases = (
      await Promise.all(
        sqlServers.slice(0, 50).map(async (server) => {
          const fqdn = (server.properties as { fullyQualifiedDomainName?: string })
            ?.fullyQualifiedDomainName;
          const dbs = (await armOptional(
            http,
            token,
            `${server.id}/databases?api-version=2023-08-01`,
          )) as ArmItem[];
          return dbs
            .filter((d) => lower(d.name) !== "master")
            .map((d): CloudDatabase => ({
              id: String(d.id),
              name: `${d.name} (${server.name})`,
              engine: "Azure SQL Database",
              region: d.location,
              size: d.sku?.name,
              hostname: fqdn,
              port: 1433,
              labels: d.tags ?? {},
            }));
        }),
      )
    ).flat();
    const flexible = (items: ArmItem[], engine: string, port: number) =>
      items.map((s): CloudDatabase => {
        const p = (s.properties ?? {}) as { fullyQualifiedDomainName?: string; version?: string };
        return {
          id: String(s.id),
          name: String(s.name),
          engine,
          version: p.version,
          region: s.location,
          size: s.sku?.name,
          hostname: p.fullyQualifiedDomainName,
          port,
          labels: s.tags ?? {},
        };
      });
    const databases = [
      ...sqlDatabases,
      ...flexible(postgres, "PostgreSQL flexible server", 5432),
      ...flexible(mysql, "MySQL flexible server", 3306),
    ];

    // Azure DNS (M27, opt-in).
    let dns: DnsRecord[] = [];
    if (config.dns !== "off") {
      const zones = (await armList(
        http,
        token,
        `${sub}/providers/Microsoft.Network/dnszones?api-version=2018-05-01`,
      )) as ArmItem[];
      const all: DnsRecord[] = [];
      for (const zone of zones.slice(0, DNS_LIMITS.zones)) {
        const sets = (await armList(
          http,
          token,
          `${zone.id}/all?api-version=2018-05-01`,
        )) as ArmItem[];
        for (const set of sets) all.push(...azureRecords(set, String(zone.name), publicById));
        if (all.length >= DNS_LIMITS.records) break;
      }
      dns = await selectDns(config.dns, all.slice(0, DNS_LIMITS.records), deps, {
        ips: [
          ...virtualMachines.flatMap((v) => `${v.privateIps},${v.publicIps}`.split(",")),
          ...loadBalancers.flatMap((l) => l.ips ?? []),
        ],
        hosts: databases.map((d) => d.hostname),
      });
    }

    return {
      format: "azure",
      text: JSON.stringify({ virtualMachines, loadBalancers, databases, dns }),
    };
  },
};

// ───────────────────────── AWS ─────────────────────────

const awsConfig = z.object({
  region: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d$/, "e.g. eu-central-1"),
  dns: dnsMode,
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
  const [ec2Sdk, rdsSdk, elbSdk, r53Sdk] = await Promise.all([
    import("@aws-sdk/client-ec2"),
    import("@aws-sdk/client-rds"),
    import("@aws-sdk/client-elastic-load-balancing-v2"),
    import("@aws-sdk/client-route-53"),
  ]);
  const opts = { region, credentials, maxAttempts: 2 };
  const ec2 = new ec2Sdk.EC2Client(opts);
  const rds = new rdsSdk.RDSClient(opts);
  const elb = new elbSdk.ElasticLoadBalancingV2Client(opts);
  // Route 53 is global; its endpoint lives in us-east-1.
  const r53 = new r53Sdk.Route53Client({ ...opts, region: "us-east-1" });
  return {
    describeInstances: (NextToken) =>
      ec2.send(new ec2Sdk.DescribeInstancesCommand({ NextToken, MaxResults: 1000 })),
    describeDbInstances: (Marker) =>
      rds.send(new rdsSdk.DescribeDBInstancesCommand({ Marker, MaxRecords: 100 })),
    describeLoadBalancers: (Marker) =>
      elb.send(new elbSdk.DescribeLoadBalancersCommand({ Marker, PageSize: 400 })),
    describeListeners: (LoadBalancerArn) =>
      elb.send(new elbSdk.DescribeListenersCommand({ LoadBalancerArn })),
    describeTargetGroups: (LoadBalancerArn) =>
      elb.send(new elbSdk.DescribeTargetGroupsCommand({ LoadBalancerArn })),
    describeTargetHealth: (TargetGroupArn) =>
      elb.send(new elbSdk.DescribeTargetHealthCommand({ TargetGroupArn })),
    listHostedZones: (Marker) =>
      r53.send(new r53Sdk.ListHostedZonesCommand({ Marker, MaxItems: 100 })),
    listRecordSets: (HostedZoneId, start) =>
      r53.send(
        new r53Sdk.ListResourceRecordSetsCommand({
          HostedZoneId,
          StartRecordName: start?.name,
          StartRecordType: start?.type as never,
          StartRecordIdentifier: start?.identifier,
          MaxItems: 300,
        }),
      ),
  };
}

const awsDenied = (error: unknown) =>
  /AccessDenied|UnauthorizedOperation|NotAuthorized/i.test((error as { name?: string }).name ?? "");

/** ELBv2 (ALB / NLB) with listeners and registered targets. Skipped without permission. */
async function awsLoadBalancers(api: AwsApi): Promise<CloudLoadBalancer[]> {
  const raw: NonNullable<Awaited<ReturnType<AwsApi["describeLoadBalancers"]>>["LoadBalancers"]> =
    [];
  try {
    let marker: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await api.describeLoadBalancers(marker);
      raw.push(...(res.LoadBalancers ?? []));
      if (!(marker = res.NextMarker)) break;
    }
  } catch (error) {
    if (awsDenied(error)) return [];
    throw error;
  }
  const KIND: Record<string, string> = {
    application: "AWS Application Load Balancer",
    network: "AWS Network Load Balancer",
    gateway: "AWS Gateway Load Balancer",
  };
  return Promise.all(
    raw.slice(0, 200).map(async (lb): Promise<CloudLoadBalancer> => {
      const arn = lb.LoadBalancerArn ?? "";
      const [listeners, groups] = await Promise.all([
        api.describeListeners(arn).catch(() => ({ Listeners: [] })),
        api.describeTargetGroups(arn).catch(() => ({ TargetGroups: [] })),
      ]);
      const targets = (
        await mapLimit(groups.TargetGroups ?? [], 5, async (tg) => {
          const health = await api
            .describeTargetHealth(tg.TargetGroupArn ?? "")
            .catch(() => ({ TargetHealthDescriptions: [] }));
          return (health.TargetHealthDescriptions ?? []).map((d) => {
            const id = d.Target?.Id ?? "";
            return tg.TargetType === "instance"
              ? { server: id }
              : tg.TargetType === "ip"
                ? { ip: id }
                : tg.TargetType === "alb"
                  ? { lb: id }
                  : {};
          });
        })
      ).flat();
      return {
        id: arn,
        name: lb.LoadBalancerName ?? arn,
        kind: KIND[lb.Type ?? ""] ?? "AWS load balancer",
        region: lb.AvailabilityZones?.[0]?.ZoneName?.replace(/[a-z]$/, ""),
        hostname: lb.DNSName,
        ports: (listeners.Listeners ?? []).map((l) => l.Port).filter((p): p is number => !!p),
        targets,
      };
    }),
  );
}

/** Route 53 records of every hosted zone (public and private). */
async function route53(api: AwsApi): Promise<DnsRecord[]> {
  const zones: { Id?: string; Name?: string }[] = [];
  let marker: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await api.listHostedZones(marker);
    zones.push(...(res.HostedZones ?? []));
    if (!res.IsTruncated || !(marker = res.NextMarker)) break;
  }
  const records: DnsRecord[] = [];
  // Route 53 escapes "*" as "\052" in names.
  const clean = (s: string) => s.replace(/\\052/g, "*").replace(/\.$/, "").toLowerCase();
  for (const zone of zones.slice(0, DNS_LIMITS.zones)) {
    const id = (zone.Id ?? "").replace(/^\/hostedzone\//, "");
    let start: { name?: string; type?: string; identifier?: string } | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await api.listRecordSets(id, start);
      for (const set of res.ResourceRecordSets ?? []) {
        const name = clean(set.Name ?? "");
        const type = set.Type ?? "";
        if (set.AliasTarget?.DNSName) {
          // Alias to an AWS resource (load balancer, CloudFront…): a CNAME for us.
          const target = clean(set.AliasTarget.DNSName).replace(/^dualstack\./, "");
          if (type === "A" || type === "AAAA")
            records.push({ name, type: "CNAME", content: target, zone: clean(zone.Name ?? "") });
          continue;
        }
        for (const r of set.ResourceRecords ?? [])
          if (r.Value)
            records.push({ name, type, content: clean(r.Value), zone: clean(zone.Name ?? "") });
      }
      if (!res.IsTruncated || records.length >= DNS_LIMITS.records) break;
      start = {
        name: res.NextRecordName,
        type: res.NextRecordType,
        identifier: res.NextRecordIdentifier,
      };
    }
    if (records.length >= DNS_LIMITS.records) break;
  }
  return records.slice(0, DNS_LIMITS.records);
}

export const aws: Provider<z.infer<typeof awsConfig>, z.infer<typeof awsSecret>> = {
  configSchema: awsConfig,
  secretSchema: awsSecret,
  hint: (s) => last4(s.accessKeyId),
  async fetchExport(config, secret, deps) {
    const api = deps.aws
      ? deps.aws(config.region, secret)
      : await defaultAws(config.region, secret);
    const Reservations: unknown[] = [];
    const DBInstances: unknown[] = [];
    try {
      let next: string | undefined;
      for (let page = 0; page < 20; page++) {
        const out = await api.describeInstances(next);
        Reservations.push(...(out.Reservations ?? []));
        if (!(next = out.NextToken)) break;
      }
      let marker: string | undefined;
      for (let page = 0; page < 20; page++) {
        const out = await api.describeDbInstances(marker);
        DBInstances.push(...(out.DBInstances ?? []));
        if (!(marker = out.Marker)) break;
      }
    } catch (error) {
      const name = (error as { name?: string }).name ?? "Error";
      throw new IntegrationError(
        `AWS API: ${name} — check the region and that the key allows ec2:DescribeInstances and rds:DescribeDBInstances.`,
      );
    }
    let LoadBalancers: CloudLoadBalancer[];
    try {
      LoadBalancers = await awsLoadBalancers(api);
    } catch (error) {
      const name = (error as { name?: string }).name ?? "Error";
      throw new IntegrationError(`AWS Elastic Load Balancing: ${name}.`);
    }
    let dns: DnsRecord[] = [];
    if (config.dns !== "off") {
      let records: DnsRecord[];
      try {
        records = await route53(api);
      } catch (error) {
        const name = (error as { name?: string }).name ?? "Error";
        throw new IntegrationError(
          `Route 53: ${name} — allow route53:ListHostedZones and route53:ListResourceRecordSets, or turn DNS off.`,
        );
      }
      type Inst = { PrivateIpAddress?: string; PublicIpAddress?: string; PrivateDnsName?: string };
      const instances = (Reservations as { Instances?: Inst[] }[]).flatMap(
        (r) => r.Instances ?? [],
      );
      dns = await selectDns(config.dns, records, deps, {
        ips: instances.flatMap((i) => [i.PrivateIpAddress, i.PublicIpAddress]),
        hosts: [
          ...LoadBalancers.map((l) => l.hostname),
          ...(DBInstances as { Endpoint?: { Address?: string } }[]).map((d) => d.Endpoint?.Address),
        ],
      });
    }
    return {
      format: "aws",
      text: JSON.stringify({ Reservations, DBInstances, LoadBalancers, dns }),
    };
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
        ? linkedRecords(
            result as unknown as { name: string; type: string; content: string }[],
            (await libraryIps?.()) ?? new Set(),
          )
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
  VULTR: vultr,
  LINODE: linode,
  IONOS: ionos,
  ORACLE_CLOUD: oracleCloud,
  TAILSCALE: tailscale,
  PROXMOX: proxmox,
  TRUENAS: truenas,
  SYNOLOGY: synology,
  NETBOX: netbox,
  ZABBIX: zabbix,
  PRTG: prtg,
} as const;
export type ProviderKind = keyof typeof PROVIDERS;
