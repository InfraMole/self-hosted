// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { languageAlternates } from "@/lib/i18n";
import { LISTED_LEGAL_DOCS } from "@/lib/legal";
import { renderLegal } from "@/server/legal";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return LISTED_LEGAL_DOCS.map(({ slug }) => ({ doc: slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/es/legal/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  return {
    title: LISTED_LEGAL_DOCS.find((d) => d.slug === doc)?.es ?? "Legal",
    alternates: languageAlternates(`/legal/${doc}`),
  };
}

export default async function LegalPageEs({ params }: PageProps<"/es/legal/[doc]">) {
  const { doc } = await params;
  if (!LISTED_LEGAL_DOCS.some((d) => d.slug === doc)) notFound();
  const html = await renderLegal("es", doc);
  return <article className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
