// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { getDb, systemDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { DEMO_EMAIL } from "@/server/modules/demo/demo";

export const SIGNUP_CLOSED_MESSAGE =
  "Registration is closed on this server. Ask an administrator for an invitation.";

/** No account exists yet besides the demo one: the first user may always sign up. */
export async function isBootstrap(): Promise<boolean> {
  return (await getDb().user.count({ where: { email: { not: DEMO_EMAIL } } })) === 0;
}

/** Whether /sign-up should show its form (the server hook still decides per email). */
export async function signUpFormAvailable(next: string | null): Promise<boolean> {
  if (getEnv().SIGNUP === "open") return true;
  if (next?.startsWith("/invite/")) return true;
  return isBootstrap();
}

/**
 * Sign-up gate (M13). With SIGNUP=closed an account can only be created by:
 *  - the first user of the installation (bootstrap; the demo account does not
 *    count), or
 *  - someone with a pending, unexpired invitation to that email address.
 * Enforced in the Better Auth user.create hook, so it covers the form and
 * Google / Microsoft sign-ups alike.
 */
export async function signUpAllowed(email: string): Promise<boolean> {
  if (getEnv().SIGNUP === "open") return true;
  const normalized = email.trim().toLowerCase();
  if (await isBootstrap()) return true;
  const invitation = await systemDb(
    "sign-up gate: pending invitation for this email",
  ).invitation.findFirst({
    where: { email: normalized, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(invitation);
}
