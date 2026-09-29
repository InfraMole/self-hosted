// SPDX-License-Identifier: AGPL-3.0-only
export const SLUG_MIN = 3;
export const SLUG_MAX = 48;
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** "Acme Corp — Prod" -> "acme-corp-prod". May return "" for non-latin input. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug);
}

/** Base slug for a workspace name, padded/fallback so it is always valid. */
export function workspaceSlugBase(name: string): string {
  const s = slugify(name);
  if (s.length >= SLUG_MIN) return s;
  return s ? `${s}-ws` : "workspace";
}
