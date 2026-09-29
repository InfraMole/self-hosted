// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type Stripe from "stripe";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { systemDb, tenantDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { recordAudit } from "@/server/modules/audit/audit";
import {
  billingGateway,
  stripeClient,
  stripeConfigured,
  type BillingGateway,
  type StripeSubscriptionSnapshot,
} from "./gateway";
import type { CloudTier } from "@/lib/billing-plans";
import { ACTIVE_STATUSES, asTier } from "./subscriptions";

/**
 * Cloud billing (ADR-023): one flat monthly subscription per workspace, on
 * one of three tiers (one Stripe Price each). OWNER starts Checkout; tier
 * changes, payment method, invoices and cancellation happen in the Stripe
 * Customer Portal. Stripe webhooks are the source of truth.
 */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

function assertEnabled() {
  if (!stripeConfigured()) throw new BillingError("Billing is not enabled on this installation.");
}

const billingUrl = (slug: string, query = "") =>
  `${getEnv().BETTER_AUTH_URL.replace(/\/$/, "")}/w/${slug}/settings/billing${query}`;

/** The Stripe Price configured for each tier, and back. */
export function priceForTier(tier: CloudTier): string {
  const env = getEnv();
  const price = {
    starter: env.STRIPE_PRICE_STARTER,
    team: env.STRIPE_PRICE_TEAM,
    scale: env.STRIPE_PRICE_SCALE,
  }[tier];
  if (!price) throw new BillingError("Billing is not enabled on this installation.");
  return price;
}

export function tierForPrice(priceId: string | null): CloudTier | null {
  if (!priceId) return null;
  const env = getEnv();
  if (priceId === env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === env.STRIPE_PRICE_TEAM) return "team";
  if (priceId === env.STRIPE_PRICE_SCALE) return "scale";
  return null;
}

/** OWNER. Returns the Stripe Checkout URL for a tier. */
export async function startCheckout(
  ctx: WorkspaceContext,
  ownerEmail: string,
  tier: CloudTier,
  gateway: BillingGateway = billingGateway(),
): Promise<string> {
  if (!asTier(tier)) throw new BillingError("Unknown plan.");
  assertRole(ctx, "OWNER");
  assertEnabled();
  const db = tenantDb(ctx);
  let row = await db.workspaceSubscription.findUnique({ where: { workspaceId: ctx.workspaceId } });
  if (row && ACTIVE_STATUSES.has(row.status))
    throw new BillingError(
      "This workspace already has a plan — use “Manage billing” to change it.",
    );
  if (!row) {
    const customer = await gateway.createCustomer({
      name: ctx.workspaceName,
      email: ownerEmail,
      workspaceId: ctx.workspaceId,
    });
    row = await db.workspaceSubscription.create({
      data: { workspaceId: ctx.workspaceId, stripeCustomerId: customer.id },
    });
  }
  const session = await gateway.createCheckoutSession({
    customerId: row.stripeCustomerId,
    priceId: priceForTier(tier),
    workspaceId: ctx.workspaceId,
    successUrl: billingUrl(ctx.workspaceSlug, "?checkout=success"),
    cancelUrl: billingUrl(ctx.workspaceSlug, "?checkout=cancel"),
  });
  return session.url;
}

/** OWNER. Stripe Customer Portal (payment method, invoices, cancel). */
export async function openPortal(
  ctx: WorkspaceContext,
  gateway: BillingGateway = billingGateway(),
): Promise<string> {
  assertRole(ctx, "OWNER");
  assertEnabled();
  const row = await tenantDb(ctx).workspaceSubscription.findUnique({
    where: { workspaceId: ctx.workspaceId },
  });
  if (!row) throw new BillingError("There is no billing account for this workspace yet.");
  return (
    await gateway.createPortalSession({
      customerId: row.stripeCustomerId,
      returnUrl: billingUrl(ctx.workspaceSlug),
    })
  ).url;
}

/** Verifies the Stripe signature (throws on a forged or stale payload). */
export function verifyWebhook(payload: string, signature: string | null): Stripe.Event {
  if (!signature) throw new BillingError("Missing Stripe signature");
  return stripeClient().webhooks.constructEvent(
    payload,
    signature,
    getEnv().STRIPE_WEBHOOK_SECRET!,
  );
}

/**
 * Applies a verified Stripe event. For any subscription event the current
 * state is re-fetched from Stripe, so out-of-order delivery cannot roll the
 * state back. The workspace comes from our metadata and must match the
 * customer we created for it.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  gateway: BillingGateway = billingGateway(),
): Promise<"applied" | "ignored"> {
  let subscriptionId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    subscriptionId =
      typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null);
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  }
  if (!subscriptionId) return "ignored";
  return applySubscription(await gateway.retrieveSubscription(subscriptionId));
}

async function applySubscription(sub: StripeSubscriptionSnapshot): Promise<"applied" | "ignored"> {
  const db = systemDb("Stripe webhook: resolve the workspace of a customer");
  const row = await db.workspaceSubscription.findUnique({
    where: { stripeCustomerId: sub.customerId },
  });
  if (!row || (sub.workspaceId && sub.workspaceId !== row.workspaceId)) {
    console.warn(`[billing] ignored subscription ${sub.id}: customer/workspace mismatch`);
    return "ignored";
  }
  const before = ACTIVE_STATUSES.has(row.status) ? (asTier(row.tier) ?? "team") : "none";
  const isActive = ACTIVE_STATUSES.has(sub.status);
  // An unknown price keeps the previous tier (e.g. a legacy price) rather than dropping the plan.
  const tier = tierForPrice(sub.priceId) ?? asTier(row.tier);
  const after = isActive ? (tier ?? "team") : "none";
  await tenantDb({ workspaceId: row.workspaceId }).$transaction(async (tx) => {
    await tx.workspaceSubscription.update({
      where: { workspaceId: row.workspaceId },
      data: {
        stripeSubscriptionId: sub.id,
        status: sub.status,
        tier,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      },
    });
    if (before !== after)
      await recordAudit(tx, {
        workspaceId: row.workspaceId,
        action: "billing.plan_changed",
        actor: { type: "SYSTEM", label: "Stripe" },
        target: { type: "workspace", id: row.workspaceId },
        metadata: { from: before, to: after, status: sub.status },
      });
  });
  return "applied";
}
