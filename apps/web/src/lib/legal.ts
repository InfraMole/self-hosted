// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from "./i18n";

/**
 * Legal documents (M12). Sources: apps/web/content/legal/*.md, rendered at
 * build time by app/legal/[doc]. `listed: false` = reachable by URL but not
 * linked in the footer / legal nav: the Cloud-only documents stay unlisted
 * until InfraMole Cloud opens (the site is a non-commercial open source
 * project until then).
 * `es` = Spanish title (M14): only listed documents are translated
 * (content/legal/es/*.md, served at /es/legal/<slug>).
 */
export const LEGAL_DOCS = [
  { slug: "notice", title: "Legal notice", es: "Aviso legal", listed: true },
  { slug: "privacy", title: "Privacy Policy", es: "Política de privacidad", listed: true },
  { slug: "terms", title: "Terms of Service", es: null, listed: false },
  { slug: "subprocessors", title: "Sub-processors", es: null, listed: false },
] as const;

export const LISTED_LEGAL_DOCS = LEGAL_DOCS.filter((d) => d.listed);

/** Title of a listed legal document in a language. */
export function legalTitle(doc: (typeof LEGAL_DOCS)[number], locale: Locale): string {
  return locale === "es" && doc.es ? doc.es : doc.title;
}

export type LegalSlug = (typeof LEGAL_DOCS)[number]["slug"];

/** Recorded on each new Cloud account; bump when the Terms change materially. */
export const TERMS_VERSION = "2026-09-29-draft";
