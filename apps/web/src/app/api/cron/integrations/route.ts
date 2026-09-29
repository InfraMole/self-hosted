// SPDX-License-Identifier: AGPL-3.0-only
import { cronGuard } from "@/server/cron";
import { jsonResponse } from "@/server/http";
import { syncDueIntegrations } from "@/server/modules/integrations/integrations";

export const dynamic = "force-dynamic";

/**
 * Scheduled integration sync (ADR-018). Call from the platform scheduler:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/integrations
 * Disabled (404) unless CRON_SECRET is configured.
 */
export async function POST(request: Request) {
  return cronGuard(request) ?? jsonResponse(await syncDueIntegrations(), 200);
}
