// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { ZodError } from "zod";
import type { WorkspaceContext } from "@/server/authz";
import { clientIp, jsonResponse } from "@/server/http";
import { bearerSecret } from "@/server/modules/agents/secrets";
import { rateLimit } from "@/server/rate-limit";
import { authenticateApiToken } from "./tokens";
import { ApiNotFoundError } from "./v1";

/** Requests per minute per token, and per client IP (any token or none). */
export const API_RATE = { perToken: 300, perIp: 600 } as const;

/**
 * Wraps a read-only /api/v1 handler (M30, ADR-044): bearer token → scoped
 * read-only context, rate limits, JSON errors. The workspace comes ONLY from
 * the token. GET only: there is no write endpoint.
 */
export async function apiRequest(
  request: Request,
  run: (ctx: WorkspaceContext, query: Record<string, string>) => Promise<unknown>,
): Promise<Response> {
  const ip = rateLimit(`api-ip:${clientIp(request)}`, API_RATE.perIp, 60_000);
  if (!ip.allowed) return limited(ip.retryAfterSec);

  const secret = bearerSecret(request.headers.get("authorization"), "api");
  const ctx = secret ? await authenticateApiToken(secret) : null;
  if (!ctx)
    return jsonResponse(
      {
        error: "unauthorized",
        message: "Send a valid API token: Authorization: Bearer dmp_api_…",
      },
      401,
      { "WWW-Authenticate": "Bearer" },
    );

  const token = rateLimit(`api-token:${ctx.userId}`, API_RATE.perToken, 60_000);
  if (!token.allowed) return limited(token.retryAfterSec);

  const query = Object.fromEntries(new URL(request.url).searchParams);
  try {
    return jsonResponse(await run(ctx, query), 200);
  } catch (error) {
    if (error instanceof ApiNotFoundError)
      return jsonResponse({ error: "not_found", message: error.message }, 404);
    if (error instanceof ZodError)
      return jsonResponse(
        {
          error: "invalid_query",
          issues: error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
        400,
      );
    throw error;
  }
}

function limited(retryAfterSec: number) {
  return jsonResponse({ error: "rate_limited" }, 429, { "Retry-After": String(retryAfterSec) });
}
