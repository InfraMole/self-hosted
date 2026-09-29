// SPDX-License-Identifier: AGPL-3.0-only
import { execSync } from "node:child_process";
import path from "node:path";
import { config } from "dotenv";

/** Roles are cluster-wide: dev and test share the local depmap_app password. */
export const TEST_APP_PASSWORD = "depmap_app_dev";

/** Applies migrations to the test database once per run. */
export default function setup() {
  config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Start Postgres with `pnpm db:up` and copy apps/web/.env.example to apps/web/.env.",
    );
  }
  if (!/_test\b/.test(new URL(url).pathname)) {
    throw new Error(
      "Refusing to run integration tests: DATABASE_URL_TEST must point to a *_test database.",
    );
  }
  const cwd = path.resolve(import.meta.dirname, "../..");
  execSync("pnpm exec prisma migrate deploy", {
    cwd,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_ADMIN: url },
    stdio: "inherit",
  });
  // The app runs as the RLS-restricted role (ADR-020); tests prepare data as admin.
  execSync("pnpm exec prisma db execute --stdin", {
    cwd,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_ADMIN: url },
    input: `ALTER ROLE depmap_app WITH LOGIN PASSWORD '${TEST_APP_PASSWORD}';`,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
