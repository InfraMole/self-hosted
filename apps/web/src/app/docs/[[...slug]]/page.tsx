// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { DocPage, docMetadata, docStaticParams } from "@/components/docs/doc-page";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return docStaticParams();
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  return docMetadata((await params).slug, "en");
}

export default async function Doc({ params }: PageProps<"/docs/[[...slug]]">) {
  return <DocPage slug={(await params).slug} locale="en" />;
}
