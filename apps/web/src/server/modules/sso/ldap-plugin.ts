// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { z } from "zod";
import { checkLdapSignIn, provisionSsoUser } from "./sso";

export const LDAP_SIGN_IN_PATH = "/sso/ldap/sign-in";

/**
 * POST /api/auth/sso/ldap/sign-in {email, password} (M33, ADR-048). The
 * directory checks the password (./ldap.ts); the account and session are
 * made the way Better Auth makes them for any external identity, linked by
 * the entry's DN. Under /sso/ so that SIGNUP=closed lets verified-domain
 * accounts in, like the other SSO sign-ins.
 */
export function ldapSignIn(): BetterAuthPlugin {
  return {
    id: "inframole-ldap",
    endpoints: {
      ldapSignIn: createAuthEndpoint(
        LDAP_SIGN_IN_PATH,
        {
          method: "POST",
          body: z.object({
            email: z.string().trim().toLowerCase().email().max(320),
            password: z.string().min(1).max(1024),
          }),
        },
        async (ctx) => {
          const { email, password } = ctx.body;
          const check = await checkLdapSignIn(email, password);
          if (!check.ok)
            throw new APIError(
              check.code === "invalid_credentials" ? "UNAUTHORIZED" : "BAD_REQUEST",
              {
                code: check.code,
                message: check.message,
              },
            );
          const result = await handleOAuthUserInfo(ctx, {
            userInfo: { id: check.dn, email, name: check.name, emailVerified: true, image: null },
            account: { providerId: check.providerId, accountId: check.dn.toLowerCase() },
            isTrustedProvider: true,
            trustProviderByName: false,
            selectedUser:
              check.decision.action === "link"
                ? { userId: check.decision.userId, profile: "preserve" }
                : undefined,
          });
          if (result.error || !result.data)
            throw new APIError("BAD_REQUEST", {
              code: "sso_failed",
              message: "Single sign-on did not complete. Try again.",
            });
          const { session, user } = result.data;
          await provisionSsoUser(check.providerId, { id: user.id, email: user.email });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
    rateLimit: [{ pathMatcher: (path) => path === LDAP_SIGN_IN_PATH, window: 60, max: 5 }],
  };
}
