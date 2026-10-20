// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { BEFORE_SEND, beforeSend, isPublicPath, type AnalyticsConfig } from "@/lib/analytics";

/**
 * Umami on the public website (ADR-047). Mounted once in the root layout.
 * Loads nothing unless the first page is public AND the installation set
 * UMAMI_* (asked at runtime: docs pages are prerendered). The tracker counts
 * page views and client-side navigation itself; the before-send filter drops
 * anything that is not a public page, so moving on into the app records
 * nothing. Cookieless; Do Not Track respected; no query strings or fragments.
 */
export function Analytics() {
  const [config, setConfig] = useState<AnalyticsConfig | null>(null);

  useEffect(() => {
    if (!isPublicPath(window.location.pathname)) return;
    let cancelled = false;
    fetch("/api/analytics")
      .then((res) => (res.status === 200 ? (res.json() as Promise<AnalyticsConfig>) : null))
      .then((value) => {
        if (cancelled || !value) return;
        (window as unknown as Record<string, unknown>)[BEFORE_SEND] = (
          type: string,
          payload: Record<string, unknown>,
        ) => beforeSend(type, payload, window.location.origin);
        setConfig(value);
      })
      .catch(() => undefined); // analytics must never break a page
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) return null;
  return (
    <Script
      id="umami"
      src={config.scriptUrl}
      strategy="afterInteractive"
      data-website-id={config.websiteId}
      data-before-send={BEFORE_SEND}
      data-exclude-search="true"
      data-exclude-hash="true"
      data-do-not-track="true"
      {...(config.domains ? { "data-domains": config.domains } : {})}
    />
  );
}
