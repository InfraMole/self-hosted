// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import Stripe from "stripe";
import { getEnv } from "@/server/env";

/**
 * The only place that talks to Stripe (M9). Everything the billing module
 * needs goes through this small interface, so tests use a fake and the rest
 * of the code never sees the SDK. No card or payment data ever reaches us:
 * Stripe Checkout and the Customer Portal are hosted by Stripe.
 */
export interface StripeSubscriptionSnapshot {
  id: string;
  customerId: string;
  status: string;
  workspaceId: string | null;
  /** Price of the (single) subscription item — decides the tier. */
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingGateway {
  createCustomer(input: {
    name: string;
    email: string;
    workspaceId: string;
  }): Promise<{ id: string }>;
  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    workspaceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  retrieveSubscription(id: string): Promise<StripeSubscriptionSnapshot>;
}

export function stripeConfigured(env = getEnv()): boolean {
  return Boolean(
    env.EDITION === "cloud" &&
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_WEBHOOK_SECRET &&
    env.STRIPE_PRICE_STARTER &&
    env.STRIPE_PRICE_TEAM &&
    env.STRIPE_PRICE_SCALE,
  );
}

const globalForStripe = globalThis as unknown as {
  __depmapStripe?: Stripe;
  __depmapBillingGatewayTest?: BillingGateway;
};

/** SDK client (also used offline for webhook signature verification). */
export function stripeClient(): Stripe {
  globalForStripe.__depmapStripe ??= new Stripe(
    getEnv().STRIPE_SECRET_KEY ?? "sk_test_unconfigured",
    {
      maxNetworkRetries: 2,
      timeout: 15_000,
      appInfo: { name: "InfraMole" },
    },
  );
  return globalForStripe.__depmapStripe;
}

/** Tests: replace every Stripe API call with a fake. */
export function setBillingGatewayForTests(gateway: BillingGateway | undefined) {
  globalForStripe.__depmapBillingGatewayTest = gateway;
}

export function toSnapshot(sub: Stripe.Subscription): StripeSubscriptionSnapshot {
  const item = sub.items.data[0];
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    status: sub.status,
    workspaceId: sub.metadata?.workspaceId ?? null,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export function billingGateway(): BillingGateway {
  if (globalForStripe.__depmapBillingGatewayTest) return globalForStripe.__depmapBillingGatewayTest;
  const stripe = stripeClient();
  return {
    async createCustomer({ name, email, workspaceId }) {
      const c = await stripe.customers.create({ name, email, metadata: { workspaceId } });
      return { id: c.id };
    },
    async createCheckoutSession(i) {
      const s = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: i.customerId,
        line_items: [{ price: i.priceId, quantity: 1 }],
        client_reference_id: i.workspaceId,
        subscription_data: { metadata: { workspaceId: i.workspaceId } },
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
      });
      if (!s.url) throw new Error("Stripe did not return a checkout URL");
      return { url: s.url };
    },
    async createPortalSession({ customerId, returnUrl }) {
      const s = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: s.url };
    },
    async retrieveSubscription(id) {
      return toSnapshot(await stripe.subscriptions.retrieve(id));
    },
  };
}
