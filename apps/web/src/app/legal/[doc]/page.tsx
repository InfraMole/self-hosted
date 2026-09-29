// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { languageAlternates } from "@/lib/i18n";
import { LEGAL_DOCS } from "@/lib/legal";
import { renderLegal } from "@/server/legal";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map(({ slug }) => ({ doc: slug }));
}

export async function generateMetadata({ params }: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  const found = LEGAL_DOCS.find((d) => d.slug === doc);
  return {
    title: found?.title ?? "Legal",
    // Only the listed documents have a Spanish version.
    alternates: found?.es ? languageAlternates(`/legal/${doc}`) : undefined,
  };
}

export default async function LegalPage({ params }: PageProps<"/legal/[doc]">) {
  const { doc } = await params;
  if (!LEGAL_DOCS.some((d) => d.slug === doc)) notFound();
  const html = await renderLegal("en", doc);
  return <article className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
