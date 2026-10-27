// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { ENVIRONMENTS, entries } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";

/** Scope of the resilience report, in the URL (shareable, printable). */
export function ResilienceFilters({ views }: { views: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2 print:hidden", pending && "opacity-70")}>
      <Select
        aria-label="Environment"
        value={params.get("environment") ?? ""}
        onChange={(e) => update("environment", e.target.value)}
        className="w-44"
      >
        <option value="">All environments</option>
        {entries(ENVIRONMENTS).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      {views.length > 0 && (
        <Select
          aria-label="Saved view"
          value={params.get("view") ?? ""}
          onChange={(e) => update("view", e.target.value)}
          className="w-52"
        >
          <option value="">Whole map</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              View: {v.name}
            </option>
          ))}
        </Select>
      )}
      <Select
        aria-label="Relationships counted"
        value={params.get("confidence") ?? "detected"}
        onChange={(e) => update("confidence", e.target.value === "detected" ? "" : e.target.value)}
        className="w-60"
      >
        <option value="confirmed">Confirmed relationships only</option>
        <option value="detected">Confirmed and detected</option>
        <option value="all">Confirmed, detected and inferred</option>
      </Select>
    </div>
  );
}
