// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Suggested exclusion rules (M19, ADR-030): traffic that is almost never an
 * application dependency — backup agents, antivirus / EDR consoles,
 * monitoring agents, remote administration. Offered with one click each,
 * never applied automatically. Client-safe (the Rules tab renders it).
 *
 * Only well-known, documented default ports; a rule matches the server-side
 * port of a connection (and a process name when given). Keep entries honest:
 * if a product uses a wide port range, list only its fixed control ports.
 */

export type RuleTemplateCategory = "backup" | "security" | "monitoring" | "administration";

export interface RuleTemplate {
  id: string;
  name: string;
  category: RuleTemplateCategory;
  /** One line: why this traffic is not a dependency. */
  description: string;
  rules: { port?: number; processName?: string }[];
}

export const RULE_TEMPLATE_CATEGORIES: Record<RuleTemplateCategory, string> = {
  backup: "Backup",
  security: "Antivirus and EDR",
  monitoring: "Monitoring",
  administration: "Remote administration",
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "veeam",
    name: "Veeam Backup & Replication",
    category: "backup",
    description: "Veeam services and transport agents talking to protected machines.",
    rules: [
      { port: 9392 },
      { port: 9393 },
      { port: 6160 },
      { port: 6162 },
      { port: 10005 },
      { port: 10006 },
    ],
  },
  {
    id: "netbackup",
    name: "Veritas NetBackup",
    category: "backup",
    description: "NetBackup client and server daemons (PBX, bpcd, vnetd).",
    rules: [{ port: 1556 }, { port: 13724 }, { port: 13782 }],
  },
  {
    id: "commvault",
    name: "Commvault",
    category: "backup",
    description: "Commvault communication services between clients and the CommServe.",
    rules: [{ port: 8400 }, { port: 8401 }, { port: 8403 }],
  },
  {
    id: "bacula",
    name: "Bacula / Bareos",
    category: "backup",
    description: "Director, file and storage daemons.",
    rules: [{ port: 9101 }, { port: 9102 }, { port: 9103 }],
  },
  {
    id: "acronis",
    name: "Acronis Cyber Protect",
    category: "backup",
    description: "Acronis agents and management server.",
    rules: [{ port: 9876 }, { port: 7780 }],
  },
  {
    id: "eset",
    name: "ESET PROTECT",
    category: "security",
    description: "ESET Management Agent connecting to its console.",
    rules: [{ port: 2222 }],
  },
  {
    id: "sophos",
    name: "Sophos (on-premises console)",
    category: "security",
    description: "Sophos Enterprise Console message relay.",
    rules: [{ port: 8192 }, { port: 8194 }],
  },
  {
    id: "trendmicro",
    name: "Trend Micro Deep Security / Apex One",
    category: "security",
    description: "Agent ↔ manager heartbeats and updates.",
    rules: [{ port: 4118 }, { port: 4119 }, { port: 4120 }, { port: 4122 }],
  },
  {
    id: "kaspersky",
    name: "Kaspersky Security Center",
    category: "security",
    description: "Network Agent connecting to the administration server.",
    rules: [{ port: 13000 }, { port: 14000 }],
  },
  {
    id: "zabbix",
    name: "Zabbix",
    category: "monitoring",
    description: "Zabbix agent (10050) and trapper / active checks (10051).",
    rules: [{ port: 10050 }, { port: 10051 }],
  },
  {
    id: "nagios",
    name: "Nagios / Icinga (NRPE, NSClient++)",
    category: "monitoring",
    description: "Monitoring checks run by the monitoring server.",
    rules: [{ port: 5666 }, { port: 12489 }, { port: 5665 }],
  },
  {
    id: "prometheus",
    name: "Prometheus exporters",
    category: "monitoring",
    description: "node_exporter and windows_exporter scraped by Prometheus.",
    rules: [{ port: 9100 }, { port: 9182 }],
  },
  {
    id: "checkmk",
    name: "Checkmk",
    category: "monitoring",
    description: "Checkmk agent polled by the monitoring site.",
    rules: [{ port: 6556 }],
  },
  {
    id: "prtg",
    name: "PRTG",
    category: "monitoring",
    description: "PRTG remote probes connecting to the core server.",
    rules: [{ port: 23560 }],
  },
  {
    id: "munin",
    name: "Munin",
    category: "monitoring",
    description: "munin-node polled by the Munin master.",
    rules: [{ port: 4949 }],
  },
  {
    id: "rdp",
    name: "Remote Desktop (RDP)",
    category: "administration",
    description: "People signing in to servers — administration, not a dependency.",
    rules: [{ port: 3389 }],
  },
  {
    id: "ssh",
    name: "SSH",
    category: "administration",
    description:
      "Administrator sessions. Leave this out if applications use SSH / SFTP to exchange files.",
    rules: [{ port: 22 }],
  },
  {
    id: "winrm",
    name: "WinRM / PowerShell remoting",
    category: "administration",
    description: "Remote management of Windows servers.",
    rules: [{ port: 5985 }, { port: 5986 }],
  },
];

export function findRuleTemplate(id: string): RuleTemplate | null {
  return RULE_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** "ports 10050, 10051" / "process MsMpEng.exe" — what a template covers. */
export function describeTemplate(t: RuleTemplate): string {
  const ports = t.rules.filter((r) => r.port !== undefined).map((r) => r.port);
  const procs = t.rules.filter((r) => r.processName).map((r) => r.processName);
  return [
    ports.length ? `port${ports.length > 1 ? "s" : ""} ${ports.join(", ")}` : null,
    procs.length ? `process${procs.length > 1 ? "es" : ""} ${procs.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
