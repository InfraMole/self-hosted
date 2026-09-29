// SPDX-License-Identifier: AGPL-3.0-only
import path from "node:path";
import { defineConfig } from "vitest/config";

const src = path.resolve(import.meta.dirname, "src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      // The real package throws outside React Server Components.
      {
        find: "server-only",
        replacement: path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
      },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Real Postgres (DATABASE_URL_TEST). See docs/DECISIONS.md ADR-013.
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        // Load test (M15): 250 / 1,000 / 2,000 servers. Only on demand:
        // `pnpm test:load` (needs `pnpm db:up`); never part of CI.
        extends: true,
        test: {
          name: "load",
          include: ["tests/load/**/*.load.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 900_000,
        },
      },
    ],
  },
});
