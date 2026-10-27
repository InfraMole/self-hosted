// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown } from "lucide-react";
import { CriticalityLabel, TypeIcon } from "@/components/resources/resource-badges";
import { Badge } from "@/components/ui/badge";
import type { Criticality, ResourceType } from "@/generated/prisma/enums";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";

export interface RankingRow {
  id: string;
  name: string;
  type: ResourceType;
  couldAffect: number;
  confirmed: number;
  covered: number;
  dependsOn: number;
  criticality: Criticality | null;
  owner: string | null;
  singlePoint: boolean;
}

type SortKey = "couldAffect" | "confirmed" | "covered" | "dependsOn";

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  {
    key: "couldAffect",
    label: "Could affect",
    title: "Resources that could be affected if it stops working",
  },
  { key: "confirmed", label: "Confirmed", title: "Of those, reached only through confirmed links" },
  { key: "covered", label: "Covered", title: "Would stay up while a redundancy group holds" },
  { key: "dependsOn", label: "Depends on", title: "Resources whose failure could affect it" },
];

/** Shown before "Show all". */
const FIRST = 10;

/**
 * A ranking of the resilience report (M44): sortable, the first rows only
 * until asked. Criticality is shown next to the computed numbers, never
 * combined with them (ADR-060).
 */
export function RankingTable({
  slug,
  rows,
  initialSort,
  label,
}: {
  slug: string;
  rows: RankingRow[];
  initialSort: SortKey;
  label: string;
}) {
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort(
    (a, b) => b[sort] - a[sort] || b.couldAffect - a.couldAffect || a.name.localeCompare(b.name),
  );
  const shown = all ? sorted : sorted.slice(0, FIRST);

  return (
    <div>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr className="border-border bg-surface text-subtle border-b text-left text-[11px] tracking-wider uppercase">
              <th className="px-3 py-2 font-medium">Resource</th>
              <th className="px-3 py-2 font-medium">Type</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="px-3 py-2 text-right font-medium"
                  aria-sort={sort === c.key ? "descending" : undefined}
                  title={c.title}
                >
                  <button
                    type="button"
                    onClick={() => setSort(c.key)}
                    className={cn(
                      "hover:text-foreground inline-flex items-center gap-1 uppercase",
                      sort === c.key && "text-foreground",
                    )}
                  >
                    {c.label}
                    {sort === c.key && <ArrowDown className="size-3" aria-hidden />}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Criticality</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-0">
                  <Link
                    href={`/w/${slug}/resources/${r.id}/impact`}
                    className="hover:text-accent flex h-9 items-center gap-2 font-mono text-[13px]"
                  >
                    <TypeIcon type={r.type} />
                    <span className="truncate">{r.name}</span>
                    {r.singlePoint && (
                      <Badge
                        className="text-warning"
                        title="Could affect other resources and has no redundancy group"
                      >
                        Single point
                      </Badge>
                    )}
                  </Link>
                </td>
                <td className="text-muted px-3 text-xs whitespace-nowrap">
                  {RESOURCE_TYPES[r.type].label}
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 text-right font-mono text-xs",
                      r[c.key] === 0 && "text-subtle",
                    )}
                  >
                    {r[c.key]}
                  </td>
                ))}
                <td className="px-3 text-xs whitespace-nowrap">
                  <CriticalityLabel criticality={r.criticality} />
                </td>
                <td className="text-muted max-w-48 truncate px-3 text-xs">
                  {r.owner ?? <span className="text-subtle">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > FIRST && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-muted hover:text-foreground mt-2 text-xs print:hidden"
        >
          {all ? `Show the first ${FIRST}` : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
