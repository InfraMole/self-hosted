// SPDX-License-Identifier: AGPL-3.0-only
import { cronGuard } from "@/server/cron";
import { jsonResponse } from "@/server/http";
import { refreshOverLimit } from "@/server/modules/billing/limits";
import { runRetention } from "@/server/modules/maintenance/retention";

export const dynamic = "force-dynamic";

/**
 * Retention policy (docs/DATA_MODEL.md §7) and, on Cloud, starting / clearing
 * the over-limit grace period of paid workspaces (ADR-023). Same guard as the sync.
 */
export async function POST(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  const retention = await runRetention();
  const billing = await refreshOverLimit();
  return jsonResponse({ ...retention, billing }, 200);
}
