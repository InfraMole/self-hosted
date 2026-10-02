// SPDX-License-Identifier: AGPL-3.0-only
/** Shared provider contract (ADR-018 D). Implementations: providers.ts, cloud-providers.ts. */
import { z } from "zod";
import type { ImportFormat } from "@/server/modules/importers/parse";
import type { DnsRecord } from "@/server/modules/importers/parse-platforms";
import type { RpcSession, SafeFetchOptions, SafeResponse } from "@/server/safe-fetch";

export type Http = (url: string, init?: SafeFetchOptions) => Promise<SafeResponse>;

export interface AwsApi {
  describeInstances(nextToken?: string): Promise<{ Reservations?: unknown[]; NextToken?: string }>;
  describeDbInstances(marker?: string): Promise<{ DBInstances?: unknown[]; Marker?: string }>;
  /** Elastic Load Balancing v2 (M27): ALB / NLB / GWLB with their targets. */
  describeLoadBalancers(marker?: string): Promise<{
    LoadBalancers?: {
      LoadBalancerArn?: string;
      LoadBalancerName?: string;
      DNSName?: string;
      Type?: string;
      AvailabilityZones?: { ZoneName?: string }[];
    }[];
    NextMarker?: string;
  }>;
  describeListeners(loadBalancerArn: string): Promise<{ Listeners?: { Port?: number }[] }>;
  describeTargetGroups(
    loadBalancerArn: string,
  ): Promise<{ TargetGroups?: { TargetGroupArn?: string; TargetType?: string }[] }>;
  describeTargetHealth(
    targetGroupArn: string,
  ): Promise<{ TargetHealthDescriptions?: { Target?: { Id?: string; Port?: number } }[] }>;
  /** Route 53 (M27). Global service: the region is ignored. */
  listHostedZones(marker?: string): Promise<{
    HostedZones?: { Id?: string; Name?: string }[];
    IsTruncated?: boolean;
    NextMarker?: string;
  }>;
  listRecordSets(
    zoneId: string,
    start?: { name?: string; type?: string; identifier?: string },
  ): Promise<{
    ResourceRecordSets?: {
      Name?: string;
      Type?: string;
      ResourceRecords?: { Value?: string }[];
      AliasTarget?: { DNSName?: string };
    }[];
    IsTruncated?: boolean;
    NextRecordName?: string;
    NextRecordType?: string;
    NextRecordIdentifier?: string;
  }>;
}

/**
 * Local sources (M27, ADR-042): HTTP and JSON-RPC to the networks the
 * administrator allowed (INTEGRATIONS_PRIVATE_NETWORKS), with an optional
 * pinned certificate fingerprint.
 */
export interface LocalDeps {
  http(url: string, init?: SafeFetchOptions & { pin?: string }): Promise<SafeResponse>;
  rpc(url: string, pin?: string): Promise<RpcSession>;
}

export interface ProviderDeps {
  http: Http;
  local?: LocalDeps;
  /** IPs owned by the workspace's non-DOMAIN resources (lower-case). Filled by integrations.ts. */
  libraryIps?: () => Promise<Set<string>>;
  aws?: (region: string, credentials: { accessKeyId: string; secretAccessKey: string }) => AwsApi;
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface ExportResult {
  format: ImportFormat;
  text: string;
}

export interface Provider<C = unknown, S = unknown> {
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S>;
  /** Last characters of the main secret, for display. */
  hint(secret: S): string;
  fetchExport(config: C, secret: S, deps: ProviderDeps): Promise<ExportResult>;
}

// ───────────────────────── DNS (M27) ─────────────────────────

/**
 * DNS records of a provider's zones, as an option of its integration:
 * "linked" = only records pointing (directly or through CNAMEs) to an IP of a
 * resource in the Library or in this same sync; "all"; "off" (the default for
 * integrations created before M27 — config is re-validated on every sync).
 */
export const dnsMode = z.enum(["off", "linked", "all"]).default("off");
export type DnsMode = z.infer<typeof dnsMode>;

/**
 * Records whose name resolves, directly or through CNAMEs, to one of `ips`
 * or to one of `hosts` (host names of resources in the same sync).
 */
export function linkedRecords<R extends Pick<DnsRecord, "name" | "type" | "content">>(
  records: R[],
  ips: Set<string>,
  hosts: Set<string> = new Set(),
): R[] {
  const norm = (s: string) => s.toLowerCase().replace(/\.$/, "");
  const keep = new Set<string>();
  for (const r of records) {
    if ((r.type === "A" || r.type === "AAAA") && ips.has(r.content.toLowerCase()))
      keep.add(norm(r.name));
    if (r.type === "CNAME" && hosts.has(norm(r.content))) keep.add(norm(r.name));
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const r of records) {
      const name = norm(r.name);
      if (r.type === "CNAME" && !keep.has(name) && keep.has(norm(r.content))) {
        keep.add(name);
        changed = true;
      }
    }
  }
  return records.filter((r) => keep.has(norm(r.name)));
}

/** Applies the integration's DNS mode; `own` = IPs / host names of this sync. */
export async function selectDns(
  mode: DnsMode,
  records: DnsRecord[],
  deps: Pick<ProviderDeps, "libraryIps">,
  own: { ips?: readonly (string | undefined)[]; hosts?: readonly (string | undefined)[] } = {},
): Promise<DnsRecord[]> {
  if (mode === "off") return [];
  const cleaned = records.filter((r) => ["A", "AAAA", "CNAME"].includes(r.type));
  if (mode === "all") return cleaned;
  const ips = new Set((await deps.libraryIps?.()) ?? []);
  for (const ip of own.ips ?? []) if (ip) ips.add(ip.toLowerCase());
  const hosts = new Set(
    (own.hosts ?? [])
      .filter((h): h is string => !!h)
      .map((h) => h.toLowerCase().replace(/\.$/, "")),
  );
  return linkedRecords(cleaned, ips, hosts);
}

/** Runs `fn` over `items` with at most `limit` in flight (APIs with one call per record). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Bounds for one sync (records are what the planner's limits allow anyway). */
export const DNS_LIMITS = { zones: 50, records: 3000 } as const;

/** Non-empty strings, first occurrence kept. */
export const strings = (xs: readonly unknown[]): string[] => [
  ...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0)),
];

export const uuid = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a GUID");
export const last4 = (s: string) => (s.length >= 8 ? s.slice(-4) : "");

export async function json(res: SafeResponse, what: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new IntegrationError(`${what}: unexpected response (HTTP ${res.status}).`);
  }
}
