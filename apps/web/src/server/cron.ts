// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";
import { jsonResponse } from "./http";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Guards /api/cron/* : 404 while CRON_SECRET is unset, 401 unless the bearer
 * matches (constant-time). Returns null when the request may proceed.
 */
export function cronGuard(request: Request): Response | null {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return jsonResponse({ error: "not_found" }, 404);
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(digest(given), digest(secret)))
    return jsonResponse({ error: "unauthorized" }, 401);
  return null;
}
