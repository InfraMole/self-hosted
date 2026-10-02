// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from "@/server/modules/api/http";
import { apiImpact } from "@/server/modules/api/v1";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/resources/[id]/impact">,
) {
  const { id } = await params;
  return apiRequest(request, async (ctx, query) => ({ data: await apiImpact(ctx, id, query) }));
}
