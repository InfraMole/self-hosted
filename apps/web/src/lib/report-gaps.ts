// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plain-language summary of what an agent's last report could not collect
 * (M39). Client-safe and pure: used by Settings › Agents and the host page.
 */
import type {
  AgentCollector,
  CollectionError,
  CollectionIssue,
} from "@/server/modules/agents/protocol";

const COLLECTOR_LABEL: Record<AgentCollector, string> = {
  sockets: "network connections",
  host: "host details",
  interfaces: "network interfaces",
  services: "services",
  iis: "IIS sites",
  nginx: "nginx sites",
  apache: "Apache sites",
  haproxy: "HAProxy frontends",
  sqlserver: "SQL Server databases",
  postgresql: "PostgreSQL databases",
  mysql: "MySQL databases",
  docker: "Docker containers",
  proxmox: "Proxmox inventory",
  vcenter: "vCenter inventory",
  hyperv: "Hyper-V inventory",
  xenorchestra: "Xen Orchestra inventory",
  kubernetes: "Kubernetes inventory",
  dns: "DNS servers",
  "sqlserver-clients": "SQL Server database clients",
};

const ERROR_LABEL: Record<CollectionError, string> = {
  "access-denied": "access denied",
  timeout: "timed out",
  unreachable: "unreachable",
  failed: "failed",
};

/** One line per kind of gap; empty when the last report was complete. */
export function reportGaps(issues: CollectionIssue[], truncated: boolean): string[] {
  const lines: string[] = [];
  if (issues.length > 0) {
    lines.push(
      `Could not read ${issues
        .map((i) => `${COLLECTOR_LABEL[i.collector]} (${ERROR_LABEL[i.error]})`)
        .join(", ")}.`,
    );
  }
  if (truncated) lines.push("Reached the report limits — some items were left out.");
  return lines;
}
