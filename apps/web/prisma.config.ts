// SPDX-License-Identifier: AGPL-3.0-only
import "dotenv/config";
import { defineConfig } from "prisma/config";

// The URL is optional here so `prisma generate` (postinstall, CI, Docker
// build) works without a database. Migrations need the owner role:
// DATABASE_URL_ADMIN when the app itself runs as depmap_app (ADR-020).
const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(url ? { datasource: { url } } : {}),
});
