// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from "@/server/modules/api/http";
import { apiResilience } from "@/server/modules/api/v1";

export const dynamic = "force-dynamic";

/** Resilience report: `?environment=` `&view=<saved view id>` `&confidence=confirmed|detected|all`. */
export async function GET(request: Request) {
  return apiRequest(request, async (ctx, query) => ({ data: await apiResilience(ctx, query) }));
}
