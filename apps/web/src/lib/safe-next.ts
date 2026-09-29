// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Post-login redirect target from `?next=`. Only same-origin absolute paths
 * are allowed (no "//host", no "/\host", no schemes) — open-redirect guard.
 */
export function safeNext(value: string | string[] | undefined | null): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  return value;
}
