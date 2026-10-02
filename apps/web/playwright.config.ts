// SPDX-License-Identifier: AGPL-3.0-only
/**
 * End-to-end tests (M28): `pnpm build && pnpm test:e2e`. One story on one
 * empty installation: the "setup" project signs up the first account,
 * creates the workspace and imports a small infrastructure through the UI;
 * the other specs run on it with the saved session.
 */
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SERVER_ENV } from "./e2e/env";

const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport,
  },
  projects: [
    { name: "setup", testMatch: /setup\.spec\.ts/ },
    {
      // Library, map and impact on the imported infrastructure only.
      name: "core",
      testMatch: /(library|map|impact|first-steps|daily|teams)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport, storageState: "e2e/.auth/owner.json" },
    },
    {
      // Sources add resources (an agent's host and workloads, Proxmox): last.
      name: "sources",
      testMatch: /(agent|integrations)\.spec\.ts/,
      dependencies: ["core"],
      use: { ...devices["Desktop Chrome"], viewport, storageState: "e2e/.auth/owner.json" },
    },
  ],
  webServer: {
    command: "pnpm exec next start",
    // Better Auth liveness: no database needed, whatever order setup runs in.
    url: `${BASE_URL}/api/auth/ok`,
    env: SERVER_ENV,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
