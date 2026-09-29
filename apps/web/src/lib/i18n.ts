// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Languages of the public website and documentation (M14, ADR-026).
 * English lives at the root, Spanish under /es with the SAME paths after the
 * prefix (/docs/x ↔ /es/docs/x), so switching language never loses the page.
 * The application itself (/w/…, sign-in, settings) stays in English for now.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** Canonical public origin, used for hreflang / canonical URLs. */
export const SITE_URL = "https://inframole.com";

/** Path of a public page in a given language ("/docs" → "/es/docs", "/#how" → "/es#how"). */
export function localePath(locale: Locale, path: string): string {
  if (locale === "en") return path;
  if (path === "/" || path === "") return "/es";
  if (path.startsWith("/#")) return `/es${path.slice(1)}`;
  return `/es${path}`;
}

/** Language of a public path. */
export function localeOf(pathname: string): Locale {
  return pathname === "/es" || pathname.startsWith("/es/") || pathname.startsWith("/es#")
    ? "es"
    : "en";
}

/** Same page without the language prefix ("/es/docs/x" → "/docs/x", "/es" → "/"). */
export function unlocalizedPath(pathname: string): string {
  if (localeOf(pathname) === "en") return pathname;
  const rest = pathname.slice(3);
  return rest === "" ? "/" : rest;
}

/** hreflang alternates for a public page given its English path. */
export function languageAlternates(path: string) {
  return {
    languages: {
      en: `${SITE_URL}${path === "/" ? "" : path}`,
      es: `${SITE_URL}${localePath("es", path)}`,
      "x-default": `${SITE_URL}${path === "/" ? "" : path}`,
    },
  };
}
