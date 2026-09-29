// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DocsEnhancer } from "@/components/docs/docs-enhancer";
import { DOCS_UI, DOC_PAGES, docsBase, findDoc } from "@/lib/docs-nav";
import { languageAlternates, type Locale } from "@/lib/i18n";
import { loadDoc } from "@/server/docs";

// Rendered at build time from repository Markdown (trusted content — SECURITY.md §5o).
const DEFAULT = "getting-started";

/** Same slugs in every language (docs-i18n.test.ts). */
export function docStaticParams() {
  return [{ slug: [] }, ...DOC_PAGES.map((p) => ({ slug: p.slug.split("/") }))];
}

function resolve(slug: string[] | undefined, locale: Locale) {
  return findDoc(slug?.join("/") || DEFAULT, locale);
}

export function docMetadata(slug: string[] | undefined, locale: Locale): Metadata {
  const found = resolve(slug, locale);
  const docs = DOCS_UI[locale].docs;
  return {
    title: found ? `${found.page.title} — ${docs}` : docs,
    alternates: languageAlternates(slug?.length ? `/docs/${slug.join("/")}` : "/docs"),
  };
}

export async function DocPage({ slug, locale }: { slug: string[] | undefined; locale: Locale }) {
  const found = resolve(slug, locale);
  if (!found) notFound();
  const { page, prev, next } = found;
  const doc = await loadDoc(page.slug, locale);
  const ui = DOCS_UI[locale];
  const base = docsBase(locale);

  return (
    <div className="flex gap-10 py-8 lg:py-10">
      <article className="min-w-0 flex-1">
        <p className="text-subtle mb-3 text-xs">
          <Link href={base} className="hover:text-foreground">
            {ui.docs}
          </Link>{" "}
          › {page.section}
        </p>
        <div className="doc-prose max-w-[78ch]" dangerouslySetInnerHTML={{ __html: doc.html }} />
        <DocsEnhancer pageKey={page.slug} locale={locale} />
        <nav
          aria-label={ui.prevNext}
          className="border-border mt-14 grid max-w-[78ch] gap-3 border-t pt-6 sm:grid-cols-2"
        >
          {prev ? (
            <Link
              href={`${base}/${prev.slug}`}
              className="border-border hover:border-accent/60 rounded-md border px-4 py-3"
            >
              <span className="text-subtle flex items-center gap-1 text-xs">
                <ArrowLeft className="size-3" /> {ui.previous}
              </span>
              <span className="font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`${base}/${next.slug}`}
              className="border-border hover:border-accent/60 rounded-md border px-4 py-3 text-right"
            >
              <span className="text-subtle flex items-center justify-end gap-1 text-xs">
                {ui.next} <ArrowRight className="size-3" />
              </span>
              <span className="font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      {doc.headings.length > 1 && (
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-24">
            <p className="text-subtle mb-3 text-xs font-medium tracking-wide uppercase">
              {ui.onThisPage}
            </p>
            <ul className="space-y-1.5 text-sm">
              {doc.headings.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "pl-3" : ""}>
                  <a href={`#${h.id}`} className="text-muted hover:text-foreground">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
