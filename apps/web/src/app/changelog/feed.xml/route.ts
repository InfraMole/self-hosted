// SPDX-License-Identifier: AGPL-3.0-only
import { releasesFeed } from "@/lib/changelog";
import { SITE_URL } from "@/lib/i18n";
import { loadReleases, releaseHtml } from "@/server/changelog";

// Static, like the page; links always point at inframole.com (M36).
export const dynamic = "force-static";

export async function GET() {
  const body = releasesFeed(await loadReleases(), { siteUrl: SITE_URL, html: releaseHtml });
  return new Response(body, {
    headers: { "content-type": "application/atom+xml; charset=utf-8" },
  });
}
