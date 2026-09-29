// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { LEGAL_DOCS } from "@/lib/legal";

// Rendered once at build time from our own repository content (trusted, no
// user input), so no sanitiser is needed and nothing is read at runtime.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map(({ slug }) => ({ doc: slug }));
}

export async function generateMetadata({ params }: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  return { title: LEGAL_DOCS.find((d) => d.slug === doc)?.title ?? "Legal" };
}

export default async function LegalPage({ params }: PageProps<"/legal/[doc]">) {
  const { doc } = await params;
  if (!LEGAL_DOCS.some((d) => d.slug === doc)) notFound();
  const source = await readFile(path.join(process.cwd(), "content", "legal", `${doc}.md`), "utf8");
  const html = await marked.parse(source, { gfm: true });
  return <article className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
