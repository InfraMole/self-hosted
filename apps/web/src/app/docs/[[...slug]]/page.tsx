// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DocsEnhancer } from "@/components/docs/docs-enhancer";
import { DOC_PAGES, findDoc } from "@/lib/docs-nav";
import { loadDoc } from "@/server/docs";

// Rendered at build time from repository Markdown (trusted content — SECURITY.md §5o).
export const dynamic = "force-static";
export const dynamicParams = false;

const DEFAULT = "getting-started";

export function generateStaticParams() {
  return [{ slug: [] }, ...DOC_PAGES.map((p) => ({ slug: p.slug.split("/") }))];
}

async function resolve(params: PageProps<"/docs/[[...slug]]">["params"]) {
  const { slug } = await params;
  return findDoc(slug?.join("/") || DEFAULT);
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const found = await resolve(params);
  return { title: found ? `${found.page.title} — Docs` : "Docs" };
}

export default async function DocPage({ params }: PageProps<"/docs/[[...slug]]">) {
  const found = await resolve(params);
  if (!found) notFound();
  const { page, prev, next } = found;
  const doc = await loadDoc(page.slug);

  return (
    <div className="flex gap-10 py-8 lg:py-10">
      <article className="min-w-0 flex-1">
        <p className="text-subtle mb-3 text-xs">
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>{" "}
          › {page.section}
        </p>
        <div className="doc-prose max-w-[78ch]" dangerouslySetInnerHTML={{ __html: doc.html }} />
        <DocsEnhancer pageKey={page.slug} />
        <nav
          aria-label="Previous and next"
          className="border-border mt-14 grid max-w-[78ch] gap-3 border-t pt-6 sm:grid-cols-2"
        >
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="border-border hover:border-accent/60 rounded-md border px-4 py-3"
            >
              <span className="text-subtle flex items-center gap-1 text-xs">
                <ArrowLeft className="size-3" /> Previous
              </span>
              <span className="font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/docs/${next.slug}`}
              className="border-border hover:border-accent/60 rounded-md border px-4 py-3 text-right"
            >
              <span className="text-subtle flex items-center justify-end gap-1 text-xs">
                Next <ArrowRight className="size-3" />
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
              On this page
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
