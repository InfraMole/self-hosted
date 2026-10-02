// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { listResources } from "@/server/modules/resources/resources";
import { requireWorkspace } from "@/server/tenancy";

export interface SearchHit {
  id: string;
  name: string;
  type: string;
  detail: string | null;
}

/** Quick search (M29, Ctrl+K): name, description, owner, tag, host name or IP. */
export async function searchResourcesAction(slug: string, q: string): Promise<SearchHit[]> {
  const ctx = await requireWorkspace(slug);
  const query = q.trim().slice(0, 100);
  if (!query) return [];
  const rows = await listResources(ctx, { q: query });
  // Exact and prefix matches first, then the rest alphabetically.
  const lower = query.toLowerCase();
  const rank = (name: string) =>
    name.toLowerCase() === lower ? 0 : name.toLowerCase().startsWith(lower) ? 1 : 2;
  return rows
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      detail: r.metadata.ipAddresses?.[0] ?? r.owner ?? r.metadata.hostname ?? null,
    }));
}
