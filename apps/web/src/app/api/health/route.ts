// SPDX-License-Identifier: AGPL-3.0-only
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + DB check. Reveals no internals (docs/SECURITY.md §5). */
export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
