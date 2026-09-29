// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { redirect } from "next/navigation";
import Stripe from "stripe";
import type { CloudTier } from "@/lib/billing-plans";
import { ForbiddenError } from "@/server/authz";
import { BillingError, openPortal, startCheckout } from "@/server/modules/billing/cloud";
import { requireUser, requireWorkspace } from "@/server/tenancy";

/** Known errors verbatim; Stripe/network errors generic (their messages can include key fragments). */
function billingFailure(error: unknown): { error: string } {
  if (error instanceof ForbiddenError || error instanceof BillingError)
    return { error: error.message };
  if (error instanceof Stripe.errors.StripeError) {
    console.error("[billing] Stripe error:", error.type, error.code ?? "");
    return { error: "Could not reach the payment provider. Try again in a moment." };
  }
  throw error;
}

/** OWNER: go to Stripe Checkout (hosted by Stripe; no card data touches us). */
export async function checkoutAction(slug: string, tier: CloudTier): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  const user = await requireUser();
  let url: string;
  try {
    url = await startCheckout(ctx, user.email, tier); // tier re-validated inside
  } catch (error) {
    return billingFailure(error);
  }
  redirect(url);
}

/** OWNER: Stripe Customer Portal (payment method, invoices, cancellation). */
export async function portalAction(slug: string): Promise<{ error?: string }> {
  const ctx = await requireWorkspace(slug);
  let url: string;
  try {
    url = await openPortal(ctx);
  } catch (error) {
    return billingFailure(error);
  }
  redirect(url);
}
