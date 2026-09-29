// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { localePath, type Locale } from "@/lib/i18n";
import { LISTED_LEGAL_DOCS, legalTitle } from "@/lib/legal";

/** Frame of /legal/* and /es/legal/*: header, list of legal documents, footer. */
export function LegalShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <div className="light flex min-h-full flex-1 flex-col" lang={locale}>
      <SiteHeader locale={locale} />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-[180px_1fr]">
        <nav
          aria-label={locale === "es" ? "Documentos legales" : "Legal documents"}
          className="flex flex-wrap gap-x-4 gap-y-2 text-sm md:flex-col"
        >
          {LISTED_LEGAL_DOCS.map((d) => (
            <Link
              key={d.slug}
              href={localePath(locale, `/legal/${d.slug}`)}
              className="text-muted hover:text-foreground"
            >
              {legalTitle(d, locale)}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
