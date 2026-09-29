// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { getDb, userDb } from "./db";
import { TERMS_VERSION } from "@/lib/legal";
import { getEnv } from "./env";
import { AccountError, prepareAccountDeletion } from "./modules/account/account";
import { recordAudit, type AuditInput } from "./modules/audit/audit";
import { mailerConfigured, resetPasswordMail, sendMail, verificationMail } from "./mail";

export const PASSWORD_MIN_LENGTH = 10;

export type SsoProvider = "google" | "microsoft";

/** SSO providers configured in the environment (M8c). */
export function enabledSsoProviders(env = getEnv()): SsoProvider[] {
  const out: SsoProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) out.push("microsoft");
  return out;
}
export const PASSWORD_MAX_LENGTH = 128;

function createAuth() {
  const env = getEnv();
  // With a real mailer, an address must be proven before signing in (and
  // before accepting invitations, which are bound to the email).
  const requireVerification = mailerConfigured();
  return betterAuth({
    appName: "InfraMole",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    // Account linking keeps Better Auth's safe defaults: an SSO identity joins an
    // existing account only when the provider verified the email (Google does;
    // Microsoft only with verified-email claims) and the local email is verified.
    socialProviders: {
      ...(enabledSsoProviders(env).includes("google") && {
        google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
      }),
      ...(enabledSsoProviders(env).includes("microsoft") && {
        microsoft: {
          clientId: env.MICROSOFT_CLIENT_ID!,
          clientSecret: env.MICROSOFT_CLIENT_SECRET!,
          tenantId: env.MICROSOFT_TENANT_ID ?? "common",
        },
      }),
    },
    user: {
      // Terms acceptance (M12, Cloud): set by the create hook below, never by clients.
      additionalFields: {
        termsVersion: { type: "string", required: false, input: false },
        termsAcceptedAt: { type: "date", required: false, input: false },
      },
      // "Delete my account deletes everything I own" (M8c). Refused while the
      // user is the only owner of a workspace that has other members.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          try {
            await prepareAccountDeletion(user);
          } catch (error) {
            if (error instanceof AccountError)
              throw new APIError("BAD_REQUEST", { message: error.message });
            throw error;
          }
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      requireEmailVerification: requireVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail(resetPasswordMail(user.email, user.name, url));
      },
      onPasswordReset: async ({ user }) => {
        await audit({
          workspaceId: null,
          action: "auth.password_reset",
          actor: { type: "USER", id: user.id, label: user.email },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: requireVerification,
      sendOnSignIn: requireVerification,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(verificationMail(user.email, user.name, url));
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14, // 14 days
      updateAge: 60 * 60 * 24, // refresh expiry daily
    },
    rateLimit: {
      enabled: env.NODE_ENV === "production",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/two-factor/enable": { window: 60, max: 5 },
        "/two-factor/disable": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
      // Origin / callbackURL checks always on (Better Auth skips them in test
      // environments by default; we want them tested and never env-dependent).
      disableOriginCheck: false,
      // Same client-IP rule as server/http.ts clientIp (rate limits, sessions).
      ipAddress: { ipAddressHeaders: env.TRUST_PROXY ? ["x-real-ip"] : ["x-forwarded-for"] },
    },
    databaseHooks: {
      user: {
        create: {
          // Cloud: creating an account (form or Google/Microsoft) accepts the
          // Terms shown on the sign-up page; record which version and when.
          before: async (user) =>
            env.EDITION === "cloud"
              ? {
                  data: { ...user, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() },
                }
              : undefined,
        },
      },
      account: {
        create: {
          after: async (account) => {
            if (account.providerId === "credential") return;
            await audit({
              workspaceId: null,
              action: "auth.sign_in_method_added",
              actor: { type: "USER", id: account.userId },
              metadata: { provider: account.providerId },
            });
          },
        },
      },
      session: {
        create: {
          // Account-level audit (M8c): every new session is a sign-in.
          after: async (session) => {
            await audit({
              workspaceId: null,
              action: "auth.sign_in",
              actor: { type: "USER", id: session.userId },
              meta: { ip: session.ipAddress, userAgent: session.userAgent },
            });
          },
        },
      },
    },
    // Must be last: lets server actions set auth cookies.
    plugins: [
      // TOTP + backup codes (M8c). Secrets encrypted with BETTER_AUTH_SECRET.
      twoFactor({ issuer: "InfraMole", backupCodeOptions: { amount: 10 } }),
      // WebAuthn passkeys, bound to the public origin.
      passkey({
        rpName: "InfraMole",
        rpID: new URL(env.BETTER_AUTH_URL).hostname,
        origin: new URL(env.BETTER_AUTH_URL).origin,
      }),
      nextCookies(),
    ],
  });
}

/** Audit failures are logged, never block authentication. */
async function audit(input: AuditInput) {
  try {
    // Account-level events are visible under the acting user's RLS scope.
    const db = input.actor.id ? userDb(input.actor.id) : getDb();
    await recordAudit(db, input);
  } catch (error) {
    console.error(
      "[audit] could not record",
      input.action,
      error instanceof Error ? error.message : "",
    );
  }
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __depmapAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__depmapAuth ??= createAuth();
  return globalForAuth.__depmapAuth;
}
