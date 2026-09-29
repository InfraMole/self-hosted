// SPDX-License-Identifier: AGPL-3.0-only
import { clientIp, jsonResponse, readJsonLimited } from "@/server/http";
import { enrollAgent } from "@/server/modules/agents/ingestion";
import { PlanLimitError } from "@/server/modules/billing/limits";
import {
  AGENT_LIMITS,
  describeIssues,
  enrollRequestSchema,
} from "@/server/modules/agents/protocol";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/** Exchange an enrollment token for a per-agent secret (docs/AGENT.md §5). */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`agent-enroll:${ip}`, 10, 60_000);
  if (!limit.allowed) {
    return jsonResponse({ error: "rate_limited" }, 429, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const body = await readJsonLimited(request, AGENT_LIMITS.enrollBodyBytes);
  if (!body.ok) return jsonResponse({ error: body.error }, body.status);

  const parsed = enrollRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request", issues: describeIssues(parsed.error) }, 422);
  }

  let result: Awaited<ReturnType<typeof enrollAgent>>;
  try {
    result = await enrollAgent(parsed.data, { ip });
  } catch (error) {
    if (error instanceof PlanLimitError)
      return jsonResponse({ error: "plan_limit", message: error.message }, 402);
    throw error;
  }
  if (!result) return jsonResponse({ error: "invalid_enrollment_token" }, 401);
  return jsonResponse(result, 201);
}
