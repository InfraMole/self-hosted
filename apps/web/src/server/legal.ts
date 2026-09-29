// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import type { Locale } from "@/lib/i18n";

/**
 * Legal documents from our own repository content (trusted, no user input),
 * rendered once at build time, so no sanitiser is needed and nothing is read
 * at runtime. English: content/legal/<slug>.md; Spanish: content/legal/es/<slug>.md.
 */
export async function renderLegal(locale: Locale, slug: string): Promise<string> {
  const dir = path.join(process.cwd(), "content", "legal", ...(locale === "es" ? ["es"] : []));
  const source = await readFile(path.join(dir, `${slug}.md`), "utf8");
  return marked.parse(source, { gfm: true });
}
