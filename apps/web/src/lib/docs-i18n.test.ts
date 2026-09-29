// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_UI, docPages } from "./docs-nav";
import { renderDoc } from "./docs-render";
import { LOCALES, type Locale } from "./i18n";
import { LISTED_LEGAL_DOCS } from "./legal";

/**
 * Keeps the English and Spanish documentation in step (M14, ADR-026): same
 * pages, same order, internal links that stay in their language and anchors
 * that exist.
 */
const CONTENT = path.join(__dirname, "..", "..", "content");
const DIR: Record<Locale, string> = {
  en: path.join(CONTENT, "docs"),
  es: path.join(CONTENT, "docs-es"),
};

function listMarkdown(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listMarkdown(path.join(dir, e.name), `${prefix}${e.name}/`)
      : e.name.endsWith(".md")
        ? [`${prefix}${e.name.slice(0, -3)}`]
        : [],
  );
}

const source = (locale: Locale, slug: string) =>
  readFileSync(path.join(DIR[locale], `${slug}.md`), "utf8");

/** Markdown links [text](/…) outside code blocks. */
function internalLinks(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...withoutCode.matchAll(/\]\((\/[^)\s]*|#[^)\s]*)\)/g)].map((m) => m[1]!);
}

describe("documentation languages", () => {
  const slugs = docPages("en").map((p) => p.slug);

  it("has the same pages, in the same order, in every language", () => {
    for (const locale of LOCALES) {
      expect(docPages(locale).map((p) => p.slug)).toEqual(slugs);
      expect(listMarkdown(DIR[locale]).sort()).toEqual([...slugs].sort());
    }
  });

  it("gives every page and section a title in every language", () => {
    for (const locale of LOCALES) {
      for (const p of docPages(locale)) {
        expect(p.title.trim()).not.toBe("");
        expect(p.section.trim()).not.toBe("");
      }
    }
  });

  it("keeps internal links in the page's language and points them at real anchors", () => {
    const headings = new Map<string, Set<string>>();
    for (const locale of LOCALES) {
      for (const slug of slugs) {
        const doc = renderDoc(source(locale, slug), DOCS_UI[locale].callouts);
        headings.set(`${locale}:${slug}`, new Set(doc.headings.map((h) => h.id)));
      }
    }
    const problems: string[] = [];
    for (const locale of LOCALES) {
      const docsPrefix = locale === "es" ? "/es/docs/" : "/docs/";
      for (const slug of slugs) {
        for (const link of internalLinks(source(locale, slug))) {
          const where = `${locale}/${slug}.md → ${link}`;
          if (link.startsWith("#")) {
            if (!headings.get(`${locale}:${slug}`)!.has(link.slice(1))) problems.push(where);
            continue;
          }
          const isSpanish = link === "/es" || link.startsWith("/es/");
          if ((locale === "es") !== isSpanish) {
            problems.push(`${where} (wrong language)`);
            continue;
          }
          if (!link.startsWith(docsPrefix)) continue;
          const [target, anchor] = link.slice(docsPrefix.length).split("#");
          const ids = headings.get(`${locale}:${target}`);
          if (!ids) problems.push(`${where} (no such page)`);
          else if (anchor && !ids.has(anchor)) problems.push(`${where} (no such anchor)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("has a Spanish version of every listed legal document", () => {
    for (const d of LISTED_LEGAL_DOCS) {
      expect(d.es).toBeTruthy();
      expect(existsSync(path.join(CONTENT, "legal", "es", `${d.slug}.md`))).toBe(true);
    }
  });
});
