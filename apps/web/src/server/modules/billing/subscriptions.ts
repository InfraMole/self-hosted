// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { CLOUD_TIERS, type CloudTier } from "@/lib/billing-plans";
import { tenantDb } from "@/server/db";

/** Stripe statuses that keep the paid plan. past_due = Stripe is retrying the payment (grace). */
export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface SubscriptionState {
  active: boolean;
  tier: CloudTier | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
}

export function asTier(value: string | null | undefined): CloudTier | null {
  return (CLOUD_TIERS as readonly string[]).includes(value ?? "") ? (value as CloudTier) : null;
}

export async function workspaceSubscription(workspaceId: string): Promise<SubscriptionState> {
  const row = await tenantDb({ workspaceId }).workspaceSubscription.findUnique({
    where: { workspaceId },
  });
  return {
    active: row ? ACTIVE_STATUSES.has(row.status) : false,
    tier: asTier(row?.tier),
    status: row?.status ?? "none",
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    hasCustomer: Boolean(row),
  };
}
