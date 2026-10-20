// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse } from "next/server";
import { analyticsConfig, contentSecurityPolicy } from "@/server/analytics";
import { getEnv } from "@/server/env";

/**
 * Sets the Content-Security-Policy at runtime (ADR-047): the same image runs
 * every installation, and only an installation with Umami configured allows
 * its origin. The other security headers stay in next.config.ts.
 */
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", policy());
  return response;
}

let cached: string | undefined;

function policy(): string {
  if (cached) return cached;
  let dev = false;
  let analyticsOrigin: string | null = null;
  try {
    const env = getEnv();
    dev = env.NODE_ENV !== "production";
    const config = analyticsConfig(env);
    analyticsOrigin = config ? new URL(config.scriptUrl).origin : null;
  } catch {
    // Invalid configuration: the app reports it elsewhere; keep the strict policy.
  }
  cached = contentSecurityPolicy({ dev, analyticsOrigin });
  return cached;
}

export const config = {
  // Everything but Next.js build assets (immutable files, no document).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
