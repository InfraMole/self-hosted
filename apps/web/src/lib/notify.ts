// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who to warn before a change (M29): the owners of what could be affected,
 * grouped, plus what has no owner yet. Pure and client-safe.
 */
import type { Confidence } from "@depmap/graph";

export interface NotifyInput {
  name: string;
  owner: string | null;
  ownerContact: string | null;
  confidence?: Confidence;
}

export interface NotifyGroup {
  owner: string;
  contact: string | null;
  resources: { name: string; confidence?: Confidence }[];
}

export function notifyList(items: readonly NotifyInput[]): {
  groups: NotifyGroup[];
  unowned: string[];
} {
  const byOwner = new Map<string, NotifyGroup>();
  const unowned: string[] = [];
  for (const item of items) {
    const owner = item.owner?.trim();
    if (!owner) {
      unowned.push(item.name);
      continue;
    }
    // Same owner written differently ("Platform team" / "platform team"): one group.
    const key = owner.toLowerCase();
    const group = byOwner.get(key) ?? { owner, contact: null, resources: [] };
    group.contact ??= item.ownerContact?.trim() || null;
    group.resources.push({ name: item.name, confidence: item.confidence });
    byOwner.set(key, group);
  }
  const groups = [...byOwner.values()].sort((a, b) => b.resources.length - a.resources.length);
  return { groups, unowned };
}

/** Plain text to paste into a change request or a message. */
export function notifyText(rootName: string, list: ReturnType<typeof notifyList>): string {
  const lines = [`If ${rootName} fails, these could be affected:`, ""];
  for (const g of list.groups)
    lines.push(
      `- ${g.owner}${g.contact ? ` (${g.contact})` : ""}: ${g.resources.map((r) => r.name).join(", ")}`,
    );
  if (list.unowned.length) lines.push(`- No owner recorded: ${list.unowned.join(", ")}`);
  return lines.join("\n");
}
