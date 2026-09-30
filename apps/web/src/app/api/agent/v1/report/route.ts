// SPDX-License-Identifier: AGPL-3.0-only
import { clientIp, jsonResponse, readJsonLimited } from "@/server/http";
import { authenticateAgent, ingestReport } from "@/server/modules/agents/ingestion";
import { PlanPausedError, assertDiscoveryActive } from "@/server/modules/billing/limits";
import {
  AGENT_FEATURES,
  AGENT_LIMITS,
  PROTOCOL_VERSION,
  describeIssues,
  reportSchemaV1,
} from "@/server/modules/agents/protocol";
import { bearerAgentSecret } from "@/server/modules/agents/secrets";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Periodic agent report (docs/AGENT.md §5). The workspace is resolved ONLY
 * from the agent credential — never from the payload. The response carries
 * configuration only: there is no command channel (docs/SECURITY.md T10).
 */
export async function POST(request: Request) {
  const secret = bearerAgentSecret(request.headers.get("authorization"));
  const agent = secret ? await authenticateAgent(secret) : null;
  if (!agent) return jsonResponse({ error: "unauthorized" }, 401);

  const limit = rateLimit(`agent-report:${agent.id}`, 10, 60_000);
  if (!limit.allowed) {
    return jsonResponse({ error: "rate_limited" }, 429, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const body = await readJsonLimited(request, AGENT_LIMITS.reportBodyBytes);
  if (!body.ok) return jsonResponse({ error: body.error }, body.status);

  const version = (body.value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== PROTOCOL_VERSION) {
    return jsonResponse(
      { error: "unsupported_schema_version", supported: [PROTOCOL_VERSION] },
      422,
    );
  }
  const parsed = reportSchemaV1.safeParse(body.value);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_report", issues: describeIssues(parsed.error) }, 422);
  }

  // Cloud trial ended without a plan (ADR-023): reports are refused, nothing is
  // deleted; the agent logs the status and keeps trying on its interval.
  try {
    await assertDiscoveryActive(agent.workspaceId);
  } catch (error) {
    if (error instanceof PlanPausedError)
      return jsonResponse({ error: "plan_paused", message: error.message }, 402);
    throw error;
  }

  const config = await ingestReport(agent, parsed.data, {
    ip: clientIp(request),
    bytes: body.bytes,
  });
  return jsonResponse({ config, features: AGENT_FEATURES }, 202);
}
