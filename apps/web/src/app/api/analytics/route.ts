// SPDX-License-Identifier: AGPL-3.0-only
import { analyticsConfig } from "@/server/analytics";

export const dynamic = "force-dynamic";

/**
 * Runtime analytics settings for the public website (ADR-047). Pages such as
 * the docs are prerendered when the image is built, so the browser asks here
 * instead. 204 = analytics off (the default of every self-hosted install).
 */
export function GET() {
  const config = analyticsConfig();
  const cache = { "Cache-Control": "public, max-age=300" };
  return config
    ? Response.json(config, { headers: cache })
    : new Response(null, { status: 204, headers: cache });
}
