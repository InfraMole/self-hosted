// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End-to-end settings (M28): the production build (`next start`) on its own
 * port, against its own database `depmap_e2e` on the same Postgres as the
 * integration tests (DATABASE_URL_TEST). Nothing here is used in production.
 */
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { parse } from "dotenv";

// Read apps/web/.env without loading it into process.env: the server under
// test must not inherit development settings (SMTP, Stripe, demo mode…).
const envFile = path.resolve(__dirname, "../.env");
const local = existsSync(envFile) ? parse(readFileSync(envFile)) : {};

export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

const testUrl = process.env.DATABASE_URL_TEST ?? local.DATABASE_URL_TEST;
if (!testUrl)
  throw new Error("DATABASE_URL_TEST is not set (apps/web/.env, or the CI environment).");

const admin = new URL(testUrl);
admin.pathname = "/depmap_e2e";
/** Owner connection: create the database, migrate, wipe. */
export const ADMIN_URL = admin.toString();

const app = new URL(ADMIN_URL);
app.username = "depmap_app";
app.password = "depmap_app_dev";
/** What the app runs as (RLS-restricted role, ADR-020). */
export const APP_URL = app.toString();

/**
 * A private IPv4 of this machine (CI runners have one): the fake Proxmox
 * listens there, and only that /32 is allowed for local sources — the real
 * INTEGRATIONS_PRIVATE_NETWORKS path, no test hook in the server.
 */
export const PRIVATE_IP = Object.values(networkInterfaces())
  .flat()
  .find(
    (a) =>
      a &&
      a.family === "IPv4" &&
      !a.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address),
  )?.address;

export const FAKE_PROXMOX_PORT = 3108;

/** The first account of the installation, created by the setup project. */
export const OWNER = {
  name: "E2E Owner",
  email: "owner@e2e.inframole.test",
  password: "e2e-password-0123",
  workspace: "E2E Infra",
  slug: "e2e-infra",
};

/** Variables the app reads that must be unset here (empty = unset, env.ts). */
const UNSET = [
  "SMTP_URL",
  "MAIL_FROM",
  "FEEDBACK_EMAIL",
  "CRON_SECRET",
  "CREDENTIALS_ENCRYPTION_KEY_PREVIOUS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "DEPMAP_LICENSE_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
];

export const SERVER_ENV: Record<string, string> = {
  ...Object.fromEntries(UNSET.map((k) => [k, ""])),
  EDITION: "community",
  SIGNUP: "open",
  PUBLIC_SITE: "false",
  DEMO_MODE: "false",
  TRUST_PROXY: "false",
  INTEGRATIONS_PRIVATE_NETWORKS: "",
  DATABASE_URL: APP_URL,
  BETTER_AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: BASE_URL,
  // 32 bytes, base64 — test-only key for stored integration credentials.
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ...(PRIVATE_IP ? { INTEGRATIONS_PRIVATE_NETWORKS: `${PRIVATE_IP}/32` } : {}),
  PORT: String(PORT),
};
