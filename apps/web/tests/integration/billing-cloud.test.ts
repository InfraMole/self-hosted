// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cloud billing with Stripe (ADR-023: one flat subscription per tier). Stripe API calls go to a fake gateway; the
 * webhook uses REAL signatures (Stripe SDK test helper) and the real route.
 */
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as webhookRoute } from "@/app/api/stripe/webhook/route";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import { BillingError, openPortal, startCheckout } from "@/server/modules/billing/cloud";
import {
  setBillingGatewayForTests,
  type BillingGateway,
  type StripeSubscriptionSnapshot,
} from "@/server/modules/billing/gateway";
import { getUsage } from "@/server/modules/billing/limits";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

process.env.EDITION = "cloud";
process.env.STRIPE_SECRET_KEY = "sk_test_fake123";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret123";
process.env.STRIPE_PRICE_STARTER = "price_starter123";
process.env.STRIPE_PRICE_TEAM = "price_team123";
process.env.STRIPE_PRICE_SCALE = "price_scale123";

const calls: { method: string; args: unknown }[] = [];
let subscriptions: Record<string, StripeSubscriptionSnapshot> = {};
const fake: BillingGateway = {
  async createCustomer(args) {
    calls.push({ method: "createCustomer", args });
    return { id: `cus_${calls.length}` };
  },
  async createCheckoutSession(args) {
    calls.push({ method: "checkout", args });
    return { url: "https://checkout.stripe.test/s/1" };
  },
  async createPortalSession(args) {
    calls.push({ method: "portal", args });
    return { url: "https://billing.stripe.test/p/1" };
  },
  async retrieveSubscription(id) {
    return subscriptions[id]!;
  },
};

beforeEach(async () => {
  await resetDatabase();
  calls.length = 0;
  subscriptions = {};
  setBillingGatewayForTests(fake);
});
afterAll(async () => {
  setBillingGatewayForTests(undefined);
  await adminDb().$disconnect();
});

async function owner(): Promise<{ ctx: WorkspaceContext; email: string }> {
  const user = await createTestUser("Owner");
  const ws = await createWorkspace(user.id, { name: "Acme" });
  return { ctx: (await findWorkspaceContextForUser(user.id, ws.slug))!, email: user.email };
}

/** A Stripe-signed webhook request, exactly as Stripe would send it. */
function signedEvent(
  type: string,
  object: Record<string, unknown>,
  secret = process.env.STRIPE_WEBHOOK_SECRET!,
) {
  const payload = JSON.stringify({
    id: `evt_${Math.random()}`,
    object: "event",
    type,
    data: { object },
  });
  const header = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret });
  return webhookRoute(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": header },
      body: payload,
    }),
  );
}

const sub = (over: Partial<StripeSubscriptionSnapshot>): StripeSubscriptionSnapshot => ({
  id: "sub_1",
  customerId: "cus_1",
  status: "active",
  workspaceId: null,
  priceId: "price_team123",
  currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  cancelAtPeriodEnd: false,
  ...over,
});

describe("checkout and portal", () => {
  it("creates one Stripe customer per workspace and checks out the chosen tier's price", async () => {
    const { ctx, email } = await owner();
    expect(await startCheckout(ctx, email, "starter")).toBe("https://checkout.stripe.test/s/1");
    await startCheckout(ctx, email, "scale");
    expect(calls.filter((c) => c.method === "createCustomer")).toHaveLength(1);
    const checkouts = calls.filter((c) => c.method === "checkout").map((c) => c.args);
    expect(checkouts).toMatchObject([
      { customerId: "cus_1", priceId: "price_starter123", workspaceId: ctx.workspaceId },
      { priceId: "price_scale123" },
    ]);
    expect(String((checkouts[0] as Record<string, unknown>).successUrl)).toContain(
      `/w/${ctx.workspaceSlug}/settings/billing?checkout=success`,
    );
    await expect(startCheckout(ctx, email, "gold" as "team")).rejects.toBeInstanceOf(BillingError);
    expect(await openPortal(ctx)).toBe("https://billing.stripe.test/p/1");
  });

  it("only owners can start checkout or open the portal", async () => {
    const { ctx } = await owner();
    const admin = await createTestUser("Admin");
    await adminDb().membership.create({
      data: { workspaceId: ctx.workspaceId, userId: admin.id, role: "ADMIN" },
    });
    const actx = (await findWorkspaceContextForUser(admin.id, ctx.workspaceSlug))!;
    await expect(startCheckout(actx, admin.email, "team")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(openPortal(actx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(openPortal(ctx)).rejects.toBeInstanceOf(BillingError); // no customer yet
  });
});

describe("webhook", () => {
  it("applies verified events (re-fetching the subscription) and audits plan changes", async () => {
    const { ctx, email } = await owner();
    await startCheckout(ctx, email, "team");
    subscriptions.sub_1 = sub({ workspaceId: ctx.workspaceId });

    const res = await signedEvent("customer.subscription.created", {
      id: "sub_1",
      object: "subscription",
    });
    expect(res.status).toBe(200);
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ plan: "cloud-team", limit: 60 });

    // Tier change in the Customer Portal = a new price on the same subscription.
    subscriptions.sub_1 = sub({ workspaceId: ctx.workspaceId, priceId: "price_scale123" });
    await signedEvent("customer.subscription.updated", { id: "sub_1", object: "subscription" });
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ plan: "cloud-scale", limit: 250 });

    // Stale event arrives late, but the state is re-fetched: still whatever Stripe says now.
    subscriptions.sub_1 = sub({
      workspaceId: ctx.workspaceId,
      priceId: "price_scale123",
      status: "canceled",
    });
    await signedEvent("customer.subscription.updated", {
      id: "sub_1",
      object: "subscription",
      status: "active",
    });
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ plan: "cloud-trial" }); // trial still running

    const audit = await adminDb().auditEvent.findMany({
      where: { action: "billing.plan_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.metadata)).toMatchObject([
      { from: "none", to: "team" },
      { from: "team", to: "scale" },
      { from: "scale", to: "none" },
    ]);
  });

  it("rejects bad signatures and ignores events for unknown or mismatched workspaces", async () => {
    const { ctx, email } = await owner();
    await startCheckout(ctx, email, "team");
    subscriptions.sub_1 = sub({ workspaceId: ctx.workspaceId });
    expect(
      (await signedEvent("customer.subscription.created", { id: "sub_1" }, "whsec_attacker"))
        .status,
    ).toBe(400);
    expect(await getUsage(ctx.workspaceId)).toMatchObject({ plan: "cloud-trial" });

    subscriptions.sub_2 = sub({ id: "sub_2", customerId: "cus_unknown" });
    expect(
      await (await signedEvent("customer.subscription.created", { id: "sub_2" })).json(),
    ).toMatchObject({ result: "ignored" });

    const other = await owner();
    subscriptions.sub_3 = sub({ id: "sub_3", workspaceId: other.ctx.workspaceId }); // metadata points elsewhere
    expect(
      await (await signedEvent("customer.subscription.created", { id: "sub_3" })).json(),
    ).toMatchObject({ result: "ignored" });
    expect(await getUsage(other.ctx.workspaceId)).toMatchObject({ plan: "cloud-trial" });
  });
});
