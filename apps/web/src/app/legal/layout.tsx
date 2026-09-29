// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { LISTED_LEGAL_DOCS } from "@/lib/legal";

export default function LegalLayout({ children }: LayoutProps<"/legal">) {
  return (
    <div className="light flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-[180px_1fr]">
        <nav
          aria-label="Legal documents"
          className="flex flex-wrap gap-x-4 gap-y-2 text-sm md:flex-col"
        >
          {LISTED_LEGAL_DOCS.map((d) => (
            <Link
              key={d.slug}
              href={`/legal/${d.slug}`}
              className="text-muted hover:text-foreground"
            >
              {d.title}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
