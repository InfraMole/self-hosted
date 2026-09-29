// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Legal documents (M12). Sources: apps/web/content/legal/*.md, rendered at
 * build time by app/legal/[doc]. `listed: false` = reachable by URL but not
 * linked in the footer / legal nav: the Cloud-only documents stay unlisted
 * until InfraMole Cloud opens (the site is a non-commercial open source
 * project until then).
 */
export const LEGAL_DOCS = [
  { slug: "notice", title: "Legal notice", listed: true },
  { slug: "privacy", title: "Privacy Policy", listed: true },
  { slug: "terms", title: "Terms of Service", listed: false },
  { slug: "subprocessors", title: "Sub-processors", listed: false },
] as const;

export const LISTED_LEGAL_DOCS = LEGAL_DOCS.filter((d) => d.listed);

export type LegalSlug = (typeof LEGAL_DOCS)[number]["slug"];

/** Recorded on each new Cloud account; bump when the Terms change materially. */
export const TERMS_VERSION = "2026-09-29-draft";
