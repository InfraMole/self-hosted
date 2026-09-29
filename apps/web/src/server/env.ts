// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

/**
 * The only place that reads process.env (see docs/ARCHITECTURE.md §8).
 * Validation is lazy so that `next build` can import route modules
 * without runtime secrets; the first real use fails fast if misconfigured.
 */
/** Empty strings in .env files mean "unset". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const base64Key = z
  .string()
  .refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "must be 32 bytes, base64 (openssl rand -base64 32)",
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().refine((v) => v.startsWith("postgres"), "must be a postgres:// URL"),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),

  // Integrations with stored read-only tokens (ADR-018 D). Required only to use them.
  CREDENTIALS_ENCRYPTION_KEY: optional(base64Key),
  /** Previous key, still accepted for decryption during rotation. */
  CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: optional(base64Key),
  CREDENTIALS_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  /** Bearer secret for /api/cron/* (scheduled integration sync). */
  CRON_SECRET: optional(z.string().min(32, "must be at least 32 characters")),

  /** Trust X-Forwarded-For (only behind our own reverse proxy — docs/DEPLOYMENT.md). */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Outgoing email (verification, password reset, invitations). Unset = log to console.
  SMTP_URL: optional(z.url().refine((v) => /^smtps?:\/\//.test(v), "must be smtp:// or smtps://")),
  MAIL_FROM: optional(z.string().min(3)),
  /** In-app feedback goes here by email (M12). Unset = the feedback button is hidden. */
  FEEDBACK_EMAIL: optional(z.email()),

  /** Where signed agent releases are published (download links in Settings › Agents). */
  AGENT_DOWNLOAD_BASE_URL: optional(z.url()),

  /**
   * Edition (ADR-024): community (self-hosted, AGPL, unlimited servers/VMs, one workspace per
   * instance) · cloud (hosted; Starter/Team/Scale tiers via Stripe, ADR-023) · business
   * (self-hosted; multiple workspaces with a valid DEPMAP_LICENSE_KEY).
   */
  EDITION: z.enum(["community", "cloud", "business"]).default("community"),
  // Cloud billing (EDITION=cloud). Key, webhook secret and the three prices enable Stripe.
  STRIPE_SECRET_KEY: optional(
    z.string().regex(/^(sk|rk)_(test|live)_\w+$/, "must be a Stripe secret or restricted key"),
  ),
  STRIPE_WEBHOOK_SECRET: optional(z.string().regex(/^whsec_\w+$/, "must start with whsec_")),
  // One flat monthly Price per Cloud tier (ADR-023).
  STRIPE_PRICE_STARTER: optional(z.string().regex(/^price_\w+$/, "must start with price_")),
  STRIPE_PRICE_TEAM: optional(z.string().regex(/^price_\w+$/, "must start with price_")),
  STRIPE_PRICE_SCALE: optional(z.string().regex(/^price_\w+$/, "must start with price_")),
  /** Business edition licence (dml1.…), issued with scripts/licence.mjs. */
  DEPMAP_LICENSE_KEY: optional(z.string().max(4096)),

  // SSO sign-in (M8c). Each provider is enabled only when both values are set.
  GOOGLE_CLIENT_ID: optional(z.string().min(8)),
  GOOGLE_CLIENT_SECRET: optional(z.string().min(8)),
  MICROSOFT_CLIENT_ID: optional(z.string().min(8)),
  MICROSOFT_CLIENT_SECRET: optional(z.string().min(8)),
  /** "common" (any account), "organizations" (work/school only) or a tenant id. */
  MICROSOFT_TENANT_ID: optional(z.string().min(3)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production" && !isHttpsOrLocalhost(env.BETTER_AUTH_URL)) {
    throw new Error(
      "Invalid environment configuration:\n  BETTER_AUTH_URL: must be https:// in production (http allowed only for localhost)",
    );
  }
  return env;
}

function isHttpsOrLocalhost(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv(process.env);
    if (cached.NODE_ENV === "production" && !cached.TRUST_PROXY)
      console.warn(
        "[env] TRUST_PROXY is not enabled: client IPs (rate limits) can be spoofed. Run behind the reverse proxy (docs/DEPLOYMENT.md).",
      );
  }
  return cached;
}
