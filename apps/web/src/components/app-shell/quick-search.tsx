// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Network, Radar, Search } from "lucide-react";
import { TypeIcon } from "@/components/resources/resource-badges";
import type { ResourceType } from "@/generated/prisma/enums";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";

export interface QuickSearchHit {
  id: string;
  name: string;
  type: string;
  detail: string | null;
}

const PAGES = [
  { label: "Library", segment: "library" },
  { label: "Map", segment: "map" },
  { label: "Suggestions", segment: "suggestions" },
  { label: "Changes", segment: "changes" },
  { label: "Settings", segment: "settings" },
  { label: "Import", segment: "library/import" },
];

type Item =
  { kind: "resource"; hit: QuickSearchHit } | { kind: "page"; label: string; segment: string };

/**
 * Quick search (M29): Ctrl+K / ⌘K anywhere in a workspace. Resources by
 * name, description, owner, tag, host name or IP, and the main pages. Enter
 * opens the resource; the map and impact are one click (or Alt+Enter: map).
 */
export function QuickSearch({
  slug,
  search,
}: {
  slug: string;
  search: (q: string) => Promise<QuickSearchHit[]>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<QuickSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search; only the latest answer is shown.
  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    if (!query) return;
    const timer = setTimeout(
      () =>
        startTransition(async () => {
          const result = await search(query);
          if (id === seq.current) {
            setHits(result);
            setActive(0);
          }
        }),
      150,
    );
    return () => clearTimeout(timer);
  }, [q, search]);

  const query = q.trim().toLowerCase();
  const items: Item[] = [
    ...(query ? hits : []).map((hit) => ({ kind: "resource" as const, hit })),
    ...PAGES.filter((p) => !query || p.label.toLowerCase().includes(query)).map((p) => ({
      kind: "page" as const,
      ...p,
    })),
  ];

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(href);
  };
  const choose = (item: Item, toMap = false) =>
    item.kind === "page"
      ? go(`/w/${slug}/${item.segment}`)
      : go(toMap ? `/w/${slug}/map?focus=${item.hit.id}` : `/w/${slug}/resources/${item.hit.id}`);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border text-subtle hover:text-foreground hover:border-border-strong mx-2 mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs"
      >
        <Search className="size-3.5" />
        <span className="flex-1">Search…</span>
        <kbd className="border-border rounded border px-1 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <DialogPrimitive.Content
            className="border-border-strong bg-surface fixed top-[12vh] left-1/2 z-50 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border shadow-2xl shadow-black/40"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
            <div className="border-border flex items-center gap-2 border-b px-3">
              <Search className="text-subtle size-4" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, items.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && items[active]) {
                    e.preventDefault();
                    choose(items[active]!, e.altKey);
                  }
                }}
                placeholder="Find a resource by name, IP, owner, tag… or a page"
                aria-label="Search resources and pages"
                className="placeholder:text-subtle h-11 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-1" role="listbox">
              {query && hits.length === 0 && (
                <li className="text-subtle px-3 py-2 text-xs">No resources match.</li>
              )}
              {items.map((item, i) => (
                <li
                  key={item.kind === "page" ? `p-${item.segment}` : item.hit.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
                    i === active && "bg-surface-2",
                  )}
                >
                  {item.kind === "resource" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => choose(item)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <TypeIcon type={item.hit.type as ResourceType} />
                        <span className="truncate font-mono text-[13px]">{item.hit.name}</span>
                        <span className="text-subtle truncate text-xs">
                          {RESOURCE_TYPES[item.hit.type as ResourceType]?.label}
                          {item.hit.detail ? ` · ${item.hit.detail}` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => choose(item, true)}
                        className="text-subtle hover:text-foreground rounded p-1"
                        title="Show on the map (Alt+Enter)"
                        aria-label={`Show ${item.hit.name} on the map`}
                      >
                        <Network className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => go(`/w/${slug}/resources/${item.hit.id}/impact`)}
                        className="text-subtle hover:text-foreground rounded p-1"
                        title="What could be affected"
                        aria-label={`What could be affected if ${item.hit.name} fails`}
                      >
                        <Radar className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => choose(item)}
                      className="text-muted flex-1 text-left"
                    >
                      Go to {item.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="border-border text-subtle border-t px-3 py-1.5 text-[11px]">
              ↑↓ to move · Enter to open · Alt+Enter on the map · Esc to close
            </p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
