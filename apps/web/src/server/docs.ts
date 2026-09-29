// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { DOC_PAGES } from "@/lib/docs-nav";
import { plainText, renderDoc, slugify, type RenderedDoc } from "@/lib/docs-render";

/** Documentation sources (apps/web/content/docs). Read at build time only (static pages). */
const DOCS_DIR = path.join(process.cwd(), "content", "docs");

export const loadDoc = cache(async (slug: string): Promise<RenderedDoc & { source: string }> => {
  const source = await readFile(path.join(DOCS_DIR, `${slug}.md`), "utf8");
  return { ...renderDoc(source), source };
});

export interface SearchEntry {
  slug: string;
  section: string;
  page: string;
  heading: string | null;
  anchor: string | null;
  text: string;
}

/** One entry per page and per `##`/`###` section, with a short text excerpt. */
export const loadSearchIndex = cache(async (): Promise<SearchEntry[]> => {
  const entries: SearchEntry[] = [];
  for (const p of DOC_PAGES) {
    const { source } = await loadDoc(p.slug);
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
