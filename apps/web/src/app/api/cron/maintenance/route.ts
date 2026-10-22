// SPDX-License-Identifier: AGPL-3.0-only
import { cronGuard } from "@/server/cron";
import { jsonResponse } from "@/server/http";
import { refreshOverLimit } from "@/server/modules/billing/limits";
import { retirePausedWorkspaces } from "@/server/modules/billing/paused";
import { runRetention } from "@/server/modules/maintenance/retention";
import { sealStoredSsoSecrets } from "@/server/modules/sso/sso-secrets";

export const dynamic = "force-dynamic";

/**
 * Retention policy (docs/DATA_MODEL.md §7) and, on Cloud, starting / clearing
 * the over-limit grace period of paid workspaces (ADR-023) and the retention
 * of paused workspaces (ADR-046), and sealing SSO secrets stored in plain
 * text or with an older key (ADR-053). Same guard as the sync.
 */
export async function POST(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  const retention = await runRetention();
  const billing = await refreshOverLimit();
  const paused = await retirePausedWorkspaces();
  const sso = await sealStoredSsoSecrets();
  return jsonResponse({ ...retention, billing, paused, sso }, 200);
}
