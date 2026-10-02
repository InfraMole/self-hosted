// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { TypeIcon } from "@/components/resources/resource-badges";
import { cn } from "@/lib/utils";
import type { MapNode } from "@/server/modules/map/map";

/**
 * Find a resource on the map (M29): by name, IP or owner. Choosing one
 * selects it and centres the map on it, whatever hides it now (a filter, a
 * focus, a collapsed box). "/" focuses the field.
 */
export function MapFind({
  nodes,
  onFind,
}: {
  nodes: readonly MapNode[];
  onFind: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const scored = nodes.flatMap((n) => {
      const name = n.name.toLowerCase();
      const score =
        name === query
          ? 0
          : name.startsWith(query)
            ? 1
            : name.includes(query)
              ? 2
              : n.ipAddresses.some((ip) => ip.startsWith(query))
                ? 3
                : n.owner?.toLowerCase().includes(query)
                  ? 4
                  : -1;
      return score < 0 ? [] : [{ n, score }];
    });
    return scored
      .sort((a, b) => a.score - b.score || a.n.name.localeCompare(b.n.name))
      .slice(0, 8)
      .map((s) => s.n);
  }, [q, nodes]);

  const choose = (n: MapNode) => {
    onFind(n.id);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="pointer-events-auto relative">
      <div className="border-border bg-surface/95 flex h-8 items-center gap-1.5 rounded-lg border px-2 backdrop-blur">
        <Search className="text-subtle size-3.5" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && matches[active]) {
              e.preventDefault();
              choose(matches[active]!);
            } else if (e.key === "Escape") {
              setQ("");
              input.current?.blur();
            }
          }}
          placeholder="Find on map  /"
          aria-label="Find a resource on the map"
          className="placeholder:text-subtle w-36 bg-transparent text-xs outline-none"
        />
      </div>
      {open && q.trim() && (
        <ul className="border-border bg-surface absolute top-full left-0 z-20 mt-1 w-72 rounded-lg border p-1 shadow-lg">
          {matches.length === 0 && <li className="text-subtle px-2 py-1.5 text-xs">No match.</li>}
          {matches.map((n, i) => (
            <li key={n.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(n)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                  i === active && "bg-surface-2",
                )}
              >
                <TypeIcon type={n.type} tech={n.tech} className="size-3.5" />
                <span className="truncate font-mono">{n.name}</span>
                {n.ipAddresses[0] && (
                  <span className="text-subtle ml-auto shrink-0 font-mono">{n.ipAddresses[0]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
