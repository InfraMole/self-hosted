// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Web analytics of the public website (ADR-047): which pages may be counted,
 * and the Umami `before-send` filter that enforces it in the browser.
 * Client-safe and pure. An allow-list, not a deny-list: a new route stays
 * private until someone adds it here on purpose.
 */

/** Public website pages, English and Spanish. Nothing under /w, /share, auth, account… */
const PUBLIC_PATH =
  /^\/(?:es\/?)?$|^\/(?:es\/)?(?:docs|legal)(?:\/[a-z0-9/-]*)?$|^\/(?:es\/)?(?:agent|demo)\/?$|^\/self-hosted\/?$/;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname);
}

/** What the browser fetches from /api/analytics (null = analytics off). */
export interface AnalyticsConfig {
  scriptUrl: string;
  websiteId: string;
  /** Comma-separated hostnames Umami may count; empty = any. */
  domains: string;
}

interface UmamiPayload {
  url?: string;
  referrer?: string;
  [key: string]: unknown;
}

/** Name of the global function the tracker calls (`data-before-send`). */
export const BEFORE_SEND = "inframoleAnalyticsBeforeSend";

/**
 * Umami `before-send` hook: drops every event whose page is not public, and
 * reduces the referrer to something harmless — an internal referrer only if
 * it is a public page, an external one without query or fragment.
 * Returning false cancels the request.
 */
export function beforeSend(
  type: string,
  payload: UmamiPayload,
  origin: string,
): UmamiPayload | false {
  // Page views and events only — never "identify" or anything newer.
  if (type !== "event") return false;
  const page = pathOf(payload.url, origin);
  if (!page || !isPublicPath(page)) return false;
  return {
    ...payload,
    url: `${new URL(origin).origin}${page}`,
    referrer: cleanReferrer(payload.referrer, origin),
  };
}

function pathOf(url: string | undefined, origin: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, origin);
    return u.origin === new URL(origin).origin ? u.pathname : null;
  } catch {
    return null;
  }
}

function cleanReferrer(referrer: string | undefined, origin: string): string {
  if (!referrer) return "";
  try {
    const u = new URL(referrer, origin);
    if (u.origin === new URL(origin).origin) return isPublicPath(u.pathname) ? u.pathname : "";
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}
