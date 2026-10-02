// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForAdmin = globalThis as unknown as { __adminDb?: PrismaClient };

/**
 * Admin (owner) connection for preparing and inspecting test data. Not subject
 * to RLS — the app under test uses adminDb()/tenantDb() as the restricted role.
 */
export function adminDb(): PrismaClient {
  globalForAdmin.__adminDb ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_ADMIN! }),
  });
  return globalForAdmin.__adminDb;
}

/** Wipes all tables (test database only — guarded in global-setup). */
export async function resetDatabase() {
  await adminDb().$executeRawUnsafe(
    'TRUNCATE TABLE "workspace_subscription", "api_token", "saved_view", "passkey", "two_factor", "audit_event", "invitation", "integration", "relationship_evidence", "connection_fact", "observation", "agent", "enrollment_token", "change_event", "relationship", "resource", "membership", "workspace", "session", "account", "verification", "user" CASCADE',
  );
}

export async function createTestUser(name = "Test User") {
  const id = randomUUID();
  return adminDb().user.create({
    data: { id, name, email: `${id}@example.test` },
  });
}
