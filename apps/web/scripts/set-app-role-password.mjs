// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enables login for the RLS-restricted role depmap_app (ADR-020) with the
 * password from APP_DB_PASSWORD (default: the local dev password). Runs as the
 * owner via DATABASE_URL_ADMIN (or DATABASE_URL). Used by `pnpm db:app-role`
 * locally and by the production migrate job after `prisma migrate deploy`.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import "dotenv/config";

const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

const password = process.env.APP_DB_PASSWORD || "depmap_app_dev";
if (!/^[A-Za-z0-9_-]{12,128}$/.test(password)) {
  console.error(
    "APP_DB_PASSWORD must be 12-128 characters of [A-Za-z0-9_-] (use deploy/scripts/gen-secrets.sh).",
  );
  process.exit(1);
}
const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_ADMIN (or DATABASE_URL) must point to the database as its owner.");
  process.exit(1);
}
execFileSync(process.execPath, [prismaCli, "db", "execute", "--stdin"], {
  input: `ALTER ROLE depmap_app WITH LOGIN PASSWORD '${password}';`,
  env: { ...process.env, DATABASE_URL: url, DATABASE_URL_ADMIN: url },
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("depmap_app can log in.");
