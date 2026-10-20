// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { getDb, userDb } from "./db";
import { TERMS_VERSION } from "@/lib/legal";
import { getEnv } from "./env";
import { AccountError, prepareAccountDeletion } from "./modules/account/account";
import { SIGNUP_CLOSED_MESSAGE, signUpAllowed } from "./modules/access/signup";
import { recordAudit, type AuditInput } from "./modules/audit/audit";
import { DEMO_EMAIL } from "./modules/demo/demo";
import { ldapSignIn } from "./modules/sso/ldap-plugin";
import { decideSsoSignIn, provisionSsoUser, ssoEnforcedFor, ssoForEmail } from "./modules/sso/sso";
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

/**
 * Account endpoints the shared demo account may not call (M13): the demo is
 * read-only, and changing its password, 2FA, passkeys, sessions or deleting it
 * would lock every other visitor out.
 */
const DEMO_LOCKED_PATHS = [
  "/update-user",
  "/change-password",
  "/change-email",
  "/set-password",
  "/delete-user",
  "/two-factor/",
  "/passkey/add",
  "/passkey/delete",
  "/passkey/update",
  "/passkey/generate-register",
  "/link-social",
  "/unlink-account",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
];
const PASSWORD_RESET_PATHS = ["/request-password-reset", "/forget-password"];

/**
 * The SSO plugin's own provider-management endpoints are switched off (404):
 * connections are managed by workspace owners through modules/sso (M33,
 * ADR-048), which also proves the domain and protects against SSRF.
 */
const SSO_ADMIN_PATHS = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];
/** Paths that sign someone in with a password: refused for SSO-only domains. */
const PASSWORD_PATHS = ["/sign-in/email", "/sign-up/email", ...PASSWORD_RESET_PATHS];
export const SSO_ONLY_MESSAGE =
  "Your organization signs in with single sign-on. Use “Sign in with SSO”.";

function createAuth() {
  const env = getEnv();
  // With a real mailer, an address must be proven before signing in (and
  // before accepting invitations, which are bound to the email).
  const requireVerification = mailerConfigured();
  return betterAuth({
    appName: "InfraMole",
    disabledPaths: SSO_ADMIN_PATHS,
    // Identity providers on a private network (SSO_TRUSTED_ORIGINS, M33): the
    // SSO plugin only calls non-public endpoints of trusted origins.
    trustedOrigins: (env.SSO_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter((o) => /^https?:\/\//.test(o)),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Native transactions: multi-step auth writes are atomic, and the SSO
    // plugin's user resolution requires them (M33).
    database: prismaAdapter(getDb(), { provider: "postgresql", transaction: true }),
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as { email?: unknown; providerId?: unknown };
        // SSO only (M33): a domain whose connection is enforced has no passwords.
        if (PASSWORD_PATHS.some((p) => ctx.path.startsWith(p)) && typeof body.email === "string") {
          if (await ssoEnforcedFor(body.email))
            throw new APIError("BAD_REQUEST", { message: SSO_ONLY_MESSAGE });
        }
        // SSO sign-in starts only towards an enabled, verified connection
        // chosen by InfraMole's own routing (never by domain or organization).
        if (ctx.path.startsWith("/sign-in/sso")) {
          const providerId = typeof body.providerId === "string" ? body.providerId : "";
          const allowed = providerId
            ? await getDb().ssoProvider.findFirst({
                where: { providerId, domainVerified: true },
                select: { id: true },
              })
            : null;
          if (!allowed)
            throw new APIError("BAD_REQUEST", { message: "This sign-in is not available." });
        }
        // Public demo (M13): the shared account is read-only at the account level too.
        if (!env.DEMO_MODE) return;
        const denied = () =>
          new APIError("BAD_REQUEST", { message: "The demo account is read-only." });
        if (PASSWORD_RESET_PATHS.some((p) => ctx.path.startsWith(p))) {
          const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "");
          if (email.trim().toLowerCase() === DEMO_EMAIL) throw denied();
          return;
        }
        if (!DEMO_LOCKED_PATHS.some((p) => ctx.path.startsWith(p))) return;
        const session = await getSessionFromCtx(ctx);
        if (session?.user.email?.toLowerCase() === DEMO_EMAIL) throw denied();
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Cloud: creating an account (form or Google/Microsoft) accepts the
          // Terms shown on the sign-up page; record which version and when.
          before: async (user, ctx) => {
            // SIGNUP=closed (M13): invitation or first user only — or, through
            // single sign-on only (M33), someone of a verified connected domain.
            // 400, not 403: the client maps 403 to "verify your email".
            const viaSso =
              Boolean(ctx?.path?.startsWith("/sso/")) && Boolean(await ssoForEmail(user.email));
            if (!viaSso && !(await signUpAllowed(user.email)))
              throw new APIError("BAD_REQUEST", { message: SIGNUP_CLOSED_MESSAGE });
            return env.EDITION === "cloud"
              ? {
                  data: { ...user, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() },
                }
              : undefined;
          },
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
            // Anonymous demo visitors (M13): no account-level trail with their
            // IP kept for a year — data minimisation. Sessions still expire.
            if (env.DEMO_MODE) {
              const user = await getDb().user.findUnique({
                where: { id: session.userId },
                select: { email: true },
              });
              if (user?.email === DEMO_EMAIL) return;
            }
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
      // Enterprise SSO (M33, ADR-048): OIDC and SAML; who gets in with which
      // role is decided by modules/sso on every sign-in.
      sso({
        domainVerification: { enabled: true, tokenPrefix: "inframole-sso" },
        organizationProvisioning: { disabled: true },
        providersLimit: 0,
        provisionUserOnEveryLogin: true,
        resolveUser: async (input) => {
          const claims =
            input.protocol === "oidc"
              ? { ...input.providerClaims, ...input.verifiedIdTokenClaims }
              : (input.providerAttributes as Record<string, unknown>);
          const decision = await decideSsoSignIn({
            providerId: input.providerId,
            email: input.providerUser.email,
            claims,
          });
          if (decision.action === "reject")
            return { action: "reject", code: decision.code, message: decision.message };
          if (decision.action === "link")
            return { action: "link", userId: decision.userId, profile: "preserve" };
          return { action: "continue" };
        },
        provisionUser: async ({ user, provider }) => {
          await provisionSsoUser(provider.providerId, { id: user.id, email: user.email });
        },
      }),
      // LDAP / Active Directory (M33): InfraMole's own endpoint.
      ldapSignIn(),
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
