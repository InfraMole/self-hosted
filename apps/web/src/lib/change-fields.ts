// SPDX-License-Identifier: AGPL-3.0-only
/** Resource fields as people read them in the change history (M41). */

const LABELS: Record<string, string> = {
  name: "name",
  type: "type",
  environment: "environment",
  criticality: "criticality",
  status: "status",
  description: "description",
  notes: "notes",
  owner: "owner",
  ownerContact: "owner contact",
  redundancyGroup: "redundancy group",
  tags: "tags",
  links: "links",
  metadata: "host details",
  hostname: "hostname",
  fqdn: "FQDN",
  os: "OS",
  version: "version",
  ipAddresses: "IP addresses",
  ports: "ports",
};

/** "redundancyGroup" → "redundancy group"; unknown fields are shown as they are. */
export function fieldLabel(field: string): string {
  return LABELS[field] ?? field;
}

/**
 * Summaries recorded before M41 list raw field names ("Updated DC02: status,
 * redundancyGroup"); show them like new ones. Anything else is left alone.
 */
export function readableSummary(summary: string): string {
  const match = /^(Updated .+): ([A-Za-z]+(?:, [A-Za-z]+)*)$/.exec(summary);
  if (!match) return summary;
  const fields = match[2]!.split(", ");
  if (!fields.every((f) => f in LABELS)) return summary;
  return `${match[1]}: ${fields.map(fieldLabel).join(", ")}`;
}
