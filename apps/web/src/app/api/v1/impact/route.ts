// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from "@/server/modules/api/http";
import { apiChangeImpact } from "@/server/modules/api/v1";

export const dynamic = "force-dynamic";

/** Combined impact of a change: `?ids=<id>,<id>…` (up to 50) `&depth=`. */
export async function GET(request: Request) {
  return apiRequest(request, async (ctx, query) => ({ data: await apiChangeImpact(ctx, query) }));
}
