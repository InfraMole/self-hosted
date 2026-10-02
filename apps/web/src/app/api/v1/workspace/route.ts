// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from "@/server/modules/api/http";
import { apiWorkspace } from "@/server/modules/api/v1";

export const dynamic = "force-dynamic";

/** The token's workspace — a cheap way to check a token (docs reference/api). */
export async function GET(request: Request) {
  return apiRequest(request, async (ctx) => ({ data: await apiWorkspace(ctx) }));
}
