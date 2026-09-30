// SPDX-License-Identifier: AGPL-3.0-only
import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/site-pages";
import { getEnv } from "@/server/env";

// Read at request time: the same image serves inframole.com and private installs.
export const dynamic = "force-dynamic";

/** Public website only (Cloud or PUBLIC_SITE); a private install lists nothing. */
export default function sitemap(): MetadataRoute.Sitemap {
  const env = getEnv();
  if (env.EDITION !== "cloud" && !env.PUBLIC_SITE) return [];
  return sitemapEntries(new URL(env.BETTER_AUTH_URL).origin, { demo: env.DEMO_MODE });
}
