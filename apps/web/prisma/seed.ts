// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Demo data for local development: `pnpm db:seed`.
 * Re-runnable: deletes and recreates the demo user + "demo" workspace only.
 *
 *   Sign in: demo@depmap.local / demo-password
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { populateExampleWorkspace } from "../src/server/modules/demo/example-data";

const DEMO_EMAIL = "demo@depmap.local";
const DEMO_PASSWORD = "demo-password";
const DEMO_SLUG = "demo";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  // The seed writes across tables as the owner (RLS does not apply to it).
  const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_ADMIN / DATABASE_URL is not set (apps/web/.env).");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    // Dev-only reset: allow the cascade to remove the demo's append-only audit rows.
    await db.$transaction([
      db.$executeRaw`SELECT set_config('depmap.allow_audit_delete', 'on', true)`,
      db.workspace.deleteMany({ where: { slug: DEMO_SLUG } }),
    ]);
    await db.user.deleteMany({ where: { email: DEMO_EMAIL } });

    const userId = randomUUID();
    await db.user.create({
      data: {
        id: userId,
        name: "Demo Admin",
        email: DEMO_EMAIL,
        emailVerified: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(DEMO_PASSWORD),
          },
        },
      },
    });

    const workspace = await db.workspace.create({
      data: {
        name: "Demo Infra",
        slug: DEMO_SLUG,
        memberships: { create: { userId, role: "OWNER" } },
      },
    });

    const counts = await populateExampleWorkspace(db, workspace.id, userId);

    console.log(
      `Seeded workspace "${workspace.slug}" with ${counts.resources} resources and ${counts.relationships} relationships (+${counts.suggestions} suggestions).`,
    );
    console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
