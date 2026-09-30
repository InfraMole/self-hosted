// SPDX-License-Identifier: AGPL-3.0-only
import { docPages } from "./docs-nav";
import { localePath } from "./i18n";
import { LISTED_LEGAL_DOCS } from "./legal";

/**
 * Public pages of the website (M18): what the sitemap lists and what
 * robots.txt allows. Every page exists in English and Spanish (ADR-026).
 * The application (/w/…, auth pages, /api) is never listed.
 */
export function publicPaths(options: { demo: boolean }): string[] {
  return [
    "/",
    ...(options.demo ? ["/demo"] : []),
    "/agent",
    "/docs",
    ...docPages("en").map((p) => `/docs/${p.slug}`),
    ...LISTED_LEGAL_DOCS.map((d) => `/legal/${d.slug}`),
  ];
}

export interface SitemapEntry {
  url: string;
  changeFrequency: "weekly" | "monthly";
  priority: number;
  alternates: { languages: Record<string, string> };
}

/** One entry per page and language, each pointing at both versions. */
export function sitemapEntries(origin: string, options: { demo: boolean }): SitemapEntry[] {
  const base = origin.replace(/\/+$/, "");
  const abs = (path: string) => `${base}${path === "/" ? "" : path}` || base;
  return publicPaths(options).flatMap((path) => {
    const languages = { en: abs(path), es: abs(localePath("es", path)), "x-default": abs(path) };
    const priority = path === "/" ? 1 : path.startsWith("/docs") ? 0.7 : 0.5;
    const changeFrequency = path.startsWith("/legal") ? ("monthly" as const) : ("weekly" as const);
    return [
      { url: languages.en, changeFrequency, priority, alternates: { languages } },
      { url: languages.es, changeFrequency, priority, alternates: { languages } },
    ];
  });
}

/** Paths that must never be crawled on a public site. */
export const PRIVATE_PATHS = [
  "/w/",
  "/api/",
  "/onboarding",
  "/account",
  "/invite/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/two-factor",
];
