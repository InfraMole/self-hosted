// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { DOCS_UI, docPages } from "@/lib/docs-nav";
import { plainText, renderDoc, slugify, type RenderedDoc } from "@/lib/docs-render";
import type { Locale } from "@/lib/i18n";

/**
 * Documentation sources: apps/web/content/docs (English) and
 * apps/web/content/docs-es (Spanish). Read at build time only (static pages).
 */
export function docsDir(locale: Locale): string {
  return path.join(process.cwd(), "content", locale === "es" ? "docs-es" : "docs");
}

export const loadDoc = cache(
  async (slug: string, locale: Locale = "en"): Promise<RenderedDoc & { source: string }> => {
    const source = await readFile(path.join(docsDir(locale), `${slug}.md`), "utf8");
    return { ...renderDoc(source, DOCS_UI[locale].callouts), source };
  },
);

export interface SearchEntry {
  slug: string;
  section: string;
  page: string;
  heading: string | null;
  anchor: string | null;
  text: string;
}

/** One entry per page and per `##`/`###` section, with a short text excerpt. */
export const loadSearchIndex = cache(async (locale: Locale = "en"): Promise<SearchEntry[]> => {
  const entries: SearchEntry[] = [];
  for (const p of docPages(locale)) {
    const { source } = await loadDoc(p.slug, locale);
    const parts = source.split(/^(#{2,3} .+)$/m);
    entries.push({
      slug: p.slug,
      section: p.section,
      page: p.title,
      heading: null,
      anchor: null,
      text: plainText(parts[0] ?? "").slice(0, 300),
    });
    for (let i = 1; i < parts.length; i += 2) {
      const heading = parts[i]!.replace(/^#+\s*/, "").replace(/`/g, "");
      entries.push({
        slug: p.slug,
        section: p.section,
        page: p.title,
        heading,
        anchor: slugify(heading),
        text: plainText(parts[i + 1] ?? "").slice(0, 300),
      });
    }
  }
  return entries;
});
