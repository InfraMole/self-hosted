// SPDX-License-Identifier: AGPL-3.0-only
/** Pure helpers turning an agent report into host-resource metadata (unit tested). */
import { z } from "zod";
import type { ResourceMetadata } from "@/server/modules/resources/schemas";
import type { ReportV1 } from "./protocol";

const ipv4 = z.ipv4();
const ipv6 = z.ipv6();
const MAX_IPS = 32;

function isUsable(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (ipv4.safeParse(ip).success) {
    return !lower.startsWith("127.") && !lower.startsWith("169.254.") && lower !== "0.0.0.0";
  }
  if (ipv6.safeParse(ip).success) {
    return lower !== "::1" && lower !== "::" && !lower.startsWith("fe80:");
  }
  return false;
}

/** Unique, routable addresses from all interfaces (CIDR suffix stripped). */
export function extractIpAddresses(interfaces: ReportV1["interfaces"]): string[] {
  const out = new Set<string>();
  for (const iface of interfaces) {
    for (const cidr of iface.addresses) {
      const ip = cidr.split("/")[0]!.trim();
      if (isUsable(ip)) out.add(ip);
      if (out.size >= MAX_IPS) return [...out];
    }
  }
  return [...out];
}

/** Metadata keys owned by the agent; other keys (e.g. `version`) are preserved. */
export function agentHostMetadata(report: ReportV1): ResourceMetadata {
  const metadata: ResourceMetadata = {
    hostname: report.host.hostname,
    os: `${report.host.osName} ${report.host.osVersion}`.trim().slice(0, 128) || report.host.os,
  };
  if (report.host.fqdn && report.host.fqdn !== report.host.hostname) {
    metadata.fqdn = report.host.fqdn;
  }
  const ips = extractIpAddresses(report.interfaces);
  if (ips.length > 0) metadata.ipAddresses = ips;
  return metadata;
}

export function mergeHostMetadata(
  existing: ResourceMetadata,
  fromAgent: ResourceMetadata,
): ResourceMetadata {
  const merged: ResourceMetadata = { ...existing, ...fromAgent };
  if (!fromAgent.fqdn) delete merged.fqdn;
  if (!fromAgent.ipAddresses) delete merged.ipAddresses;
  return merged;
}
