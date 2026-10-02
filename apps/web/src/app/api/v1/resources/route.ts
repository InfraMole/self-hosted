// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from "@/server/modules/api/http";
import { apiListResources } from "@/server/modules/api/v1";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRequest(request, (ctx, query) => apiListResources(ctx, query));
}
