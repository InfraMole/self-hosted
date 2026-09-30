// SPDX-License-Identifier: AGPL-3.0-only
import { cronGuard } from "@/server/cron";
import { jsonResponse } from "@/server/http";
import { sendDueDigests } from "@/server/modules/digest/digest";

export const dynamic = "force-dynamic";

/** Weekly change digest (M21): sends the digests due this week. Same guard as the other jobs. */
export async function POST(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  return jsonResponse({ digest: await sendDueDigests() }, 200);
}
