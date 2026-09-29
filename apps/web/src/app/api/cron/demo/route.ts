// SPDX-License-Identifier: AGPL-3.0-only
import { cronGuard } from "@/server/cron";
import { jsonResponse } from "@/server/http";
import { ensureDemo } from "@/server/modules/demo/demo";

export const dynamic = "force-dynamic";

/**
 * Public demo (M13): rebuilds the example workspace once it is older than
 * DEMO_RESET_HOURS. Same guard as the other cron jobs; a no-op ("disabled")
 * unless DEMO_MODE=true.
 */
export async function POST(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  return jsonResponse({ demo: await ensureDemo() }, 200);
}
