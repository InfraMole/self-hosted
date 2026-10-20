// SPDX-License-Identifier: AGPL-3.0-only
import type { AnalyticsConfig } from "@/lib/analytics";
import { getEnv, type Env } from "./env";

/**
 * Umami analytics of the public website (ADR-047): on only when both
 * UMAMI_SCRIPT_URL and UMAMI_WEBSITE_ID are set. No "server-only" import:
 * proxy.ts uses it for the CSP.
 */
export function analyticsConfig(env: Env = getEnv()): AnalyticsConfig | null {
  if (!env.UMAMI_SCRIPT_URL || !env.UMAMI_WEBSITE_ID) return null;
  return {
    scriptUrl: env.UMAMI_SCRIPT_URL,
    websiteId: env.UMAMI_WEBSITE_ID,
    domains: env.UMAMI_DOMAINS ?? "",
  };
}

/**
 * The Content-Security-Policy of every response (docs/SECURITY.md §5),
 * computed at runtime so one image serves every installation: the analytics
 * origin is allowed only where analytics is configured. Next.js still needs
 * inline scripts without a nonce setup (backlog hardening item).
 */
export function contentSecurityPolicy(options: { dev: boolean; analyticsOrigin?: string | null }) {
  const extra = options.analyticsOrigin ? ` ${options.analyticsOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.dev ? " 'unsafe-eval'" : ""}${extra}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${options.dev ? " ws: wss:" : ""}${extra}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
