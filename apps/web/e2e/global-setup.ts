// SPDX-License-Identifier: AGPL-3.0-only
/** A fresh, migrated `depmap_e2e` database before every run. */
import { execSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { ADMIN_URL } from "./env";

export default async function globalSetup() {
  if (!/\/depmap_e2e$/.test(new URL(ADMIN_URL).pathname))
    throw new Error("Refusing to run end-to-end tests outside depmap_e2e.");
  // Create the database from the maintenance database of the same server.
  const maintenance = new URL(ADMIN_URL);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query("DROP DATABASE IF EXISTS depmap_e2e WITH (FORCE)");
    await client.query("CREATE DATABASE depmap_e2e");
  } finally {
    await client.end();
  }
  const cwd = path.resolve(__dirname, "..");
  const env = { ...process.env, DATABASE_URL: ADMIN_URL, DATABASE_URL_ADMIN: ADMIN_URL };
  execSync("pnpm exec prisma migrate deploy", { cwd, env, stdio: "inherit" });
  // The app connects as the RLS-restricted role (ADR-020).
  execSync("pnpm exec prisma db execute --stdin", {
    cwd,
    env,
    input: "ALTER ROLE depmap_app WITH LOGIN PASSWORD 'depmap_app_dev';",
    stdio: ["pipe", "inherit", "inherit"],
  });
}
