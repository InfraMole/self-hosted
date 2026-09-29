// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Prisma } from "@/generated/prisma/client";
import { getDb, systemDb, tenantDb } from "@/server/db";
import { getEnv } from "@/server/env";
import { populateExampleWorkspace } from "./example-data";

/**
 * Public demo (M13, DEMO_MODE=true): one example workspace and one shared
 * VIEWER account whose credentials are public on /demo. The account cannot
 * change anything (server/auth.ts blocks account mutations, members.ts blocks
 * leaving); the workspace is rebuilt from the example data every 24 h.
 */
export const DEMO_EMAIL = "demo@inframole.com";
/** Public on purpose: it is shown on /demo. The account is read-only. */
export const DEMO_PASSWORD = "inframole-demo";
export const DEMO_SLUG = "demo";
export const DEMO_WORKSPACE_NAME = "Northwind (demo)";
export const DEMO_RESET_HOURS = 24;

export function demoEnabled(): boolean {
  return getEnv().DEMO_MODE;
}

export function isDemoUser(user: { email?: string | null } | null | undefined): boolean {
  return demoEnabled() && user?.email?.toLowerCase() === DEMO_EMAIL;
}

async function ensureDemoUser(): Promise<string> {
  const db = getDb(); // auth tables are not tenant data (no RLS)
  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
  if (existing) return existing.id;
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      name: "Demo visitor",
      email: DEMO_EMAIL,
      emailVerified: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: "credential",
          password: await hashPassword(DEMO_PASSWORD),
        },
      },
    },
  });
  return id;
}

export type DemoResult = "disabled" | "fresh" | "created" | "reset";

/**
 * Makes sure the demo exists and is younger than DEMO_RESET_HOURS. Idempotent
 * and cheap when nothing is due (one lookup); safe to call from /demo and the
 * cron. Concurrent callers may race: the loser's unique-slug error is ignored.
 */
export async function ensureDemo(now = new Date()): Promise<DemoResult> {
  if (!demoEnabled()) return "disabled";
  const userId = await ensureDemoUser();
  // The demo workspace is found by its fixed slug, not through a membership.
  const current = await systemDb("demo: find the demo workspace").workspace.findUnique({
    where: { slug: DEMO_SLUG },
    select: { id: true, createdAt: true },
  });
  const due =
    !current || now.getTime() - current.createdAt.getTime() > DEMO_RESET_HOURS * 3_600_000;
  if (!due) return "fresh";

  if (current) {
    await tenantDb({ workspaceId: current.id }).$transaction(async (tx) => {
      // Lets the cascade remove the demo's append-only audit rows.
      await tx.$executeRaw`SELECT set_config('depmap.allow_audit_delete', 'on', true)`;
      await tx.workspace.delete({ where: { id: current.id } });
    });
  }

  const workspaceId = randomUUID();
  try {
    await tenantDb({ workspaceId }).workspace.create({
      data: {
        id: workspaceId,
        name: DEMO_WORKSPACE_NAME,
        slug: DEMO_SLUG,
        memberships: { create: { userId, role: "VIEWER" } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return "fresh"; // another request rebuilt it first
    throw error;
  }
  await populateExampleWorkspace(tenantDb({ workspaceId }), workspaceId, null);
  return current ? "reset" : "created";
}
