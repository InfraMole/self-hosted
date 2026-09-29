// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ENVIRONMENTS, RESOURCE_TYPES, STATUSES, entries } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";

/** URL-driven filters (shareable links; the server does the filtering). */
export function LibraryFilters({
  sources = [],
}: {
  /** Provenance options (ADR-021). */
  sources?: { ref: string; label: string; removed: boolean }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function onSearch(value: string) {
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => update("q", value.trim()), 250);
  }

  const hasFilters = ["q", "type", "environment", "status", "source"].some((k) => params.get(k));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <div className="relative w-64">
        <Search className="text-subtle pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, tag, hostname, IP…"
          aria-label="Search resources"
          className="pl-8"
        />
      </div>
      <Select
        aria-label="Type"
        value={params.get("type") ?? ""}
        onChange={(e) => update("type", e.target.value)}
        className="w-40"
      >
        <option value="">All types</option>
        {entries(RESOURCE_TYPES).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Environment"
        value={params.get("environment") ?? ""}
        onChange={(e) => update("environment", e.target.value)}
        className="w-40"
      >
        <option value="">All environments</option>
        {entries(ENVIRONMENTS).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Status"
        value={params.get("status") ?? ""}
        onChange={(e) => update("status", e.target.value)}
        className="w-36"
      >
        <option value="">Not archived</option>
        {entries(STATUSES).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      {sources.length > 0 && (
        <Select
          aria-label="Source"
          value={params.get("source") ?? ""}
          onChange={(e) => update("source", e.target.value)}
          className="w-52"
        >
          <option value="">All sources</option>
          <option value="manual">Created by people</option>
          {sources.map((s) => (
            <option key={s.ref} value={s.ref}>
              {s.label}
              {s.removed ? " (removed)" : ""}
            </option>
          ))}
        </Select>
      )}
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
          className="text-muted hover:text-foreground inline-flex h-8 items-center gap-1 px-1 text-xs"
        >
          <X className="size-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
