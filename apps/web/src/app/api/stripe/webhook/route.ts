// SPDX-License-Identifier: AGPL-3.0-only
import { jsonResponse } from "@/server/http";
import { handleStripeEvent, verifyWebhook } from "@/server/modules/billing/cloud";
import { stripeConfigured } from "@/server/modules/billing/gateway";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook (M9). Register in Stripe for: checkout.session.completed,
 * customer.subscription.created / updated / deleted. 404 unless Cloud
 * billing is configured; 400 on a bad signature (nothing is applied).
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) return jsonResponse({ error: "not_found" }, 404);
  const payload = await request.text();
  if (payload.length > 1024 * 1024) return jsonResponse({ error: "payload_too_large" }, 413);
  let event;
  try {
    event = verifyWebhook(payload, request.headers.get("stripe-signature"));
  } catch {
    return jsonResponse({ error: "invalid_signature" }, 400);
  }
  const result = await handleStripeEvent(event);
  return jsonResponse({ received: true, result }, 200);
}
