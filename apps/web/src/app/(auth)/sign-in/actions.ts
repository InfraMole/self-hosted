// SPDX-License-Identifier: AGPL-3.0-only
"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { ipFromHeaders } from "@/server/http";
import { ssoForEmail } from "@/server/modules/sso/sso";
import { rateLimit } from "@/server/rate-limit";

export type SsoRouteResult =
  | { ok: true; protocol: "OIDC" | "SAML" | "LDAP"; providerId: string; name: string }
  | { ok: false; error: string };

/**
 * "Sign in with SSO" (M33): which connection signs this email's domain in.
 * Only enabled, verified connections; reveals no more than "this domain has
 * single sign-on". Rate limited per IP.
 */
export async function ssoRouteAction(email: string): Promise<SsoRouteResult> {
  const ip = ipFromHeaders(await headers());
  if (!rateLimit(`sso-route:${ip}`, 20, 60_000).allowed)
    return { ok: false, error: "Too many attempts. Try again in a minute." };
  const parsed = z.email().safeParse(email.trim());
  if (!parsed.success) return { ok: false, error: "Enter your work email address." };
  const route = await ssoForEmail(parsed.data);
  if (!route) return { ok: false, error: "Single sign-on is not set up for this email domain." };
  return { ok: true, protocol: route.protocol, providerId: route.providerId, name: route.name };
}
