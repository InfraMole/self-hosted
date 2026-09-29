// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Published legal documents (M12). Sources: apps/web/content/legal/*.md,
 * rendered at build time by app/legal/[doc]. Drafts until legal review.
 */
export const LEGAL_DOCS = [
  { slug: "terms", title: "Terms of Service" },
  { slug: "privacy", title: "Privacy Policy" },
  { slug: "subprocessors", title: "Sub-processors" },
  { slug: "notice", title: "Legal notice" },
] as const;

export type LegalSlug = (typeof LEGAL_DOCS)[number]["slug"];

/** Recorded on each new Cloud account; bump when the Terms change materially. */
export const TERMS_VERSION = "2026-09-29-draft";
