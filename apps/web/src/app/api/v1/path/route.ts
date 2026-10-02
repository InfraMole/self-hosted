// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from "@/server/modules/api/http";
import { apiPath } from "@/server/modules/api/v1";

export const dynamic = "force-dynamic";

/** How two resources are linked: `?from=<id>&to=<id>`; `data: null` when they are not. */
export async function GET(request: Request) {
  return apiRequest(request, async (ctx, query) => ({ data: await apiPath(ctx, query) }));
}
