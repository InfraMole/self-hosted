// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { DOCS_UI, docsBase, type DocSection } from "@/lib/docs-nav";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface SearchEntry {
  slug: string;
  section: string;
  page: string;
  heading: string | null;
  anchor: string | null;
  text: string;
}

/** Docs navigation (sections open where the current page lives) + client-side search. */
export function DocsSidebar({
  nav,
  index,
  locale,
}: {
  nav: DocSection[];
  index: SearchEntry[];
  locale: Locale;
}) {
  const pathname = usePathname();
  const base = docsBase(locale);
  const ui = DOCS_UI[locale];
  const current = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "") || "getting-started"
    : "";
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);
    if (!words.length) return [];
    return index
      .map((e) => {
        const title = `${e.page} ${e.heading ?? ""}`.toLowerCase();
        const body = e.text.toLowerCase();
        if (!words.every((w) => title.includes(w) || body.includes(w))) return null;
        const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : 1), 0);
        return { e, score };
      })
      .filter((r): r is { e: SearchEntry; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.e);
  }, [query, index]);

  return (
    <nav aria-label={ui.navLabel} className="flex flex-col gap-4 text-sm">
      <div className="relative">
        <Search className="text-subtle pointer-events-none absolute top-2.5 left-2.5 size-4" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ui.search}
          aria-label={ui.searchLabel}
          className="border-border bg-surface focus-visible:ring-ring/50 h-9 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-2"
        />
      </div>

      {query.trim().length > 1 ? (
        <div>
          <p className="text-subtle mb-2 text-xs">
            {results.length ? ui.results(results.length) : ui.noResults}
          </p>
          <ul className="space-y-1">
            {results.map((r) => (
              <li key={`${r.slug}#${r.anchor ?? ""}`}>
                <Link
                  href={`${base}/${r.slug}${r.anchor ? `#${r.anchor}` : ""}`}
                  onClick={() => setQuery("")}
                  className="hover:bg-surface-2 block rounded-md px-2 py-1.5"
                >
                  <span className="text-foreground block font-medium">{r.heading ?? r.page}</span>
                  <span className="text-subtle block text-xs">
                    {r.section} › {r.page}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="space-y-1">
          {nav.map((section, i) => {
            const open = section.pages.some((p) => p.slug === current);
            return (
              <li key={section.title}>
                <details open={open || i === 0} className="group">
                  <summary className="text-foreground hover:bg-surface-2 flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1.5 font-medium [&::-webkit-details-marker]:hidden">
                    {section.title}
                    <ChevronRight className="text-subtle size-4 transition-transform group-open:rotate-90" />
                  </summary>
                  <ul className="border-border mt-1 mb-2 ml-3 space-y-0.5 border-l pl-2">
                    {section.pages.map((p) => (
                      <li key={p.slug}>
                        <Link
                          href={`${base}/${p.slug}`}
                          aria-current={p.slug === current ? "page" : undefined}
                          className={cn(
                            "block rounded-md px-2 py-1",
                            p.slug === current
                              ? "bg-accent/10 text-accent font-medium"
                              : "text-muted hover:text-foreground",
                          )}
                        >
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
