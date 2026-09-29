// SPDX-License-Identifier: AGPL-3.0-only
import path from "node:path";
import { config } from "dotenv";

// Runs in each test worker before test files are imported:
// point the app's DB client at the test database.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });
// The app connects as the RLS-restricted role (ADR-020); helpers use the admin URL.
const admin = new URL(process.env.DATABASE_URL_TEST!);
const app = new URL(admin);
app.username = "depmap_app";
app.password = "depmap_app_dev"; // see global-setup.ts
process.env.DATABASE_URL_ADMIN = admin.toString();
process.env.DATABASE_URL = app.toString();
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// Integrations (ADR-018 D) — fixed test-only key and cron secret.
process.env.CREDENTIALS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.CRON_SECRET ??= "test-cron-secret-test-cron-secret-123456";
