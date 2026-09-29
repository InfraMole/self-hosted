// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Languages, X } from "lucide-react";
import { localeOf, localePath, unlocalizedPath, type Locale } from "@/lib/i18n";

const CHOICE_KEY = "inframole.lang.choice";

function remember(locale: Locale) {
  try {
    localStorage.setItem(CHOICE_KEY, locale);
  } catch {
    /* storage unavailable: the suggestion may show again */
  }
}

const noSubscription = () => () => {};

/** True when no language was chosen yet and the browser prefers `locale`. */
function browserPrefers(locale: Locale): boolean {
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem(CHOICE_KEY);
  } catch {
    /* storage unavailable: treat as not chosen */
  }
  if (chosen) return false;
  const prefersSpanish = (navigator.languages ?? [navigator.language]).some((l) =>
    l?.toLowerCase().startsWith("es"),
  );
  return (prefersSpanish ? "es" : "en") === locale;
}

/** The same page in the other language (/docs/x ↔ /es/docs/x). */
function useOtherLanguage() {
  const pathname = usePathname();
  const current = localeOf(pathname);
  const other: Locale = current === "en" ? "es" : "en";
  return { other, href: localePath(other, unlocalizedPath(pathname)) };
}

/** EN / ES switch in the site header. Choosing a language also silences the suggestion. */
export function LanguageSwitch({ label, title }: { label: string; title: string }) {
  const { other, href } = useOtherLanguage();
  return (
    <Link
      href={href}
      hrefLang={other}
      title={title}
      onClick={() => remember(other)}
      className="text-muted hover:text-foreground flex items-center gap-1.5 px-1 text-sm"
    >
      <Languages className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="font-mono text-xs uppercase sm:hidden">{other}</span>
    </Link>
  );
}

/**
 * Offers the other language when the browser prefers it. Never redirects on
 * its own (ADR-026): search engines and people keep the URL they asked for.
 */
export function LanguageSuggestion({
  text,
  action,
  dismiss,
}: {
  text: string;
  action: string;
  dismiss: string;
}) {
  const { other, href } = useOtherLanguage();
  const [dismissed, setDismissed] = useState(false);
  // Browser-only facts: false on the server and during hydration, then read once.
  const wanted = useSyncExternalStore(
    noSubscription,
    () => browserPrefers(other),
    () => false,
  );
  const show = wanted && !dismissed;

  if (!show) return null;
  return (
    <div className="border-border bg-surface border-b" lang={other}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6">
        <p className="text-muted">
          {text}{" "}
          <Link
            href={href}
            hrefLang={other}
            onClick={() => remember(other)}
            className="text-accent font-medium hover:underline"
          >
            {action}
          </Link>
        </p>
        <button
          type="button"
          aria-label={dismiss}
          onClick={() => {
            remember(other === "en" ? "es" : "en");
            setDismissed(true);
          }}
          className="text-subtle hover:text-foreground rounded p-1"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * The root layout is shared by both languages and says lang="en"; Spanish
 * pages correct it here (the server-rendered content also carries lang="es").
 */
export function HtmlLang({ lang }: { lang: Locale }) {
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [lang]);
  return null;
}
