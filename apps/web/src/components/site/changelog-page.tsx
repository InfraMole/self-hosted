// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { Rss } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { CHANGELOG_FEED_PATH, releaseAnchor, releaseTitle } from "@/lib/changelog";
import { localePath, type Locale } from "@/lib/i18n";
import { loadReleases, releaseHtml } from "@/server/changelog";

const copy = {
  en: {
    eyebrow: "changelog",
    title: "What's new",
    intro:
      "Every release of the InfraMole server and agent. Follow it in a feed reader, or in Slack or Teams with their RSS apps — no account and nothing to install.",
    feed: "RSS / Atom feed",
    upgrade: "How to upgrade",
    english: null,
    agent: "Agent",
    server: "Server",
  },
  es: {
    eyebrow: "novedades",
    title: "Novedades",
    intro:
      "Cada versión del servidor y del agente de InfraMole. Síguelas en un lector de RSS, o en Slack o Teams con sus apps de RSS: sin cuenta y sin instalar nada.",
    feed: "Feed RSS / Atom",
    upgrade: "Cómo actualizar",
    english: "Las notas de cada versión se publican en inglés.",
    agent: "Agente",
    server: "Servidor",
  },
} as const;

/** /changelog and /es/changelog (M36): the release notes, static, newest first. */
export async function ChangelogPage({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const releases = await loadReleases();
  const date = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="light flex min-h-full flex-1 flex-col" lang={locale}>
      <SiteHeader locale={locale} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-14 sm:px-6">
        <p className="text-accent font-mono text-xs tracking-wide">{t.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t.title}</h1>
        <p className="text-muted mt-4 max-w-2xl text-base leading-relaxed">{t.intro}</p>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a
            href={CHANGELOG_FEED_PATH}
            className="text-accent inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
          >
            <Rss className="size-4" aria-hidden /> {t.feed}
          </a>
          <Link
            href={localePath(locale, "/docs/operations/upgrade")}
            className="text-accent underline-offset-4 hover:underline"
          >
            {t.upgrade}
          </Link>
        </div>
        {t.english && <p className="text-subtle mt-4 text-xs">{t.english}</p>}

        <div className="divide-border mt-10 divide-y">
          {releases.map((r) => {
            const id = releaseAnchor(r.product, r.version);
            return (
              <article key={id} id={id} className="scroll-mt-20 py-8">
                <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-lg font-semibold">
                    <a href={`#${id}`} className="hover:text-accent">
                      {releaseTitle(r)}
                    </a>
                  </h2>
                  <span className="border-border text-muted rounded border px-1.5 py-0.5 text-[11px]">
                    {r.product === "agent" ? t.agent : t.server}
                  </span>
                  <time dateTime={r.date} className="text-subtle text-xs">
                    {date.format(new Date(`${r.date}T00:00:00Z`))}
                  </time>
                </header>
                <div
                  className="doc-prose mt-3"
                  dangerouslySetInnerHTML={{ __html: releaseHtml(r.body) }}
                />
              </article>
            );
          })}
        </div>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
