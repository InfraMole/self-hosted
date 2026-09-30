// SPDX-License-Identifier: AGPL-3.0-only
import type { MetadataRoute } from "next";
import { PRIVATE_PATHS } from "@/lib/site-pages";
import { getEnv } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * A public website (Cloud or PUBLIC_SITE) lets crawlers read the site and the
 * docs, never the application. Any other installation is someone's private
 * InfraMole: nothing is indexed (M18).
 */
export default function robots(): MetadataRoute.Robots {
  const env = getEnv();
  if (env.EDITION !== "cloud" && !env.PUBLIC_SITE) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${origin}/sitemap.xml`,
  };
}
