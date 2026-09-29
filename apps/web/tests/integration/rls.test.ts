// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Postgres Row Level Security — the second tenant barrier (ADR-020). These
 * tests deliberately write queries that FORGET the workspace filter, as a
 * buggy module would, and check that the database still isolates tenants.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, systemDb, tenantDb, userDb } from "@/server/db";
import { createWorkspace } from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

async function twoTenants() {
  const alice = await createTestUser("Alice");
  const bob = await createTestUser("Bob");
  const acme = await createWorkspace(alice.id, { name: "Acme" });
  const globex = await createWorkspace(bob.id, { name: "Globex" });
  for (const [ws, name] of [
    [acme.id, "acme-db"],
    [globex.id, "globex-db"],
  ] as const)
    await adminDb().resource.create({ data: { workspaceId: ws, name, type: "DATABASE" } });
  return { alice, bob, acme, globex };
}

describe("row level security", () => {
  it("the app connects as the restricted role", async () => {
    const [row] = await getDb().$queryRaw<{ user: string; bypass: boolean; superuser: boolean }[]>`
      SELECT current_user AS "user", r.rolbypassrls AS bypass, r.rolsuper AS superuser
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(row).toEqual({ user: "depmap_app", bypass: false, superuser: false });
  });

  it("no scope → no tenant rows (fails closed)", async () => {
    await twoTenants();
    expect(await getDb().resource.findMany()).toEqual([]);
    expect(await getDb().workspace.count()).toBe(0);
  });

  it("a query that forgets the workspace filter only sees its own tenant", async () => {
    const { acme, globex } = await twoTenants();
    const forgetful = await tenantDb({ workspaceId: acme.id }).resource.findMany(); // no where!
    expect(forgetful.map((r) => r.name)).toEqual(["acme-db"]);
    expect(await tenantDb({ workspaceId: globex.id }).resource.count()).toBe(1);
    // Even an explicit filter for the other tenant returns nothing.
    expect(
      await tenantDb({ workspaceId: acme.id }).resource.findMany({
        where: { workspaceId: globex.id },
      }),
    ).toEqual([]);
  });

  it("cannot write into another tenant", async () => {
    const { acme, globex } = await twoTenants();
    await expect(
      tenantDb({ workspaceId: acme.id }).resource.create({
        data: { workspaceId: globex.id, name: "planted", type: "SERVER" },
      }),
    ).rejects.toThrow(/row-level security|violates/i);
    const { count } = await tenantDb({ workspaceId: acme.id }).resource.updateMany({
      where: { workspaceId: globex.id },
      data: { name: "hijacked" },
    });
    expect(count).toBe(0);
    expect(
      (await adminDb().resource.findFirstOrThrow({ where: { workspaceId: globex.id } })).name,
    ).toBe("globex-db");
  });

  it("interactive transactions are scoped too", async () => {
    const { acme } = await twoTenants();
    const names = await tenantDb({ workspaceId: acme.id }).$transaction(async (tx) => {
      await tx.resource.create({ data: { workspaceId: acme.id, name: "in-tx", type: "SERVER" } });
      return (await tx.resource.findMany({ orderBy: { name: "asc" } })).map((r) => r.name);
    });
    expect(names).toEqual(["acme-db", "in-tx"]);
  });

  it("the scope never leaks to the next query on a pooled connection", async () => {
    const { acme } = await twoTenants();
    for (let i = 0; i < 5; i++) {
      expect(await tenantDb({ workspaceId: acme.id }).resource.count()).toBe(1);
      expect(await getDb().resource.count()).toBe(0);
    }
  });

  it("concurrent queries of different tenants are never batched together", async () => {
    // Prisma batches concurrent findUnique calls into one statement; each
    // scoped operation runs in its own transaction so batches never mix scopes.
    const { acme, globex } = await twoTenants();
    const target = await adminDb().resource.findFirstOrThrow({ where: { workspaceId: acme.id } });
    const [own, other] = await Promise.all([
      tenantDb({ workspaceId: acme.id }).resource.findUnique({ where: { id: target.id } }),
      tenantDb({ workspaceId: globex.id }).resource.findUnique({ where: { id: target.id } }),
    ]);
    expect(own?.name).toBe("acme-db");
    expect(other).toBeNull();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        tenantDb({ workspaceId: i % 2 ? acme.id : globex.id }).resource.findMany(),
      ),
    );
    results.forEach((rows, i) =>
      expect(rows.map((r) => r.name)).toEqual([i % 2 ? "acme-db" : "globex-db"]),
    );
  });

  it("user scope sees own memberships and workspaces only; system scope sees all", async () => {
    const { alice, acme } = await twoTenants();
    const mine = await userDb(alice.id).workspace.findMany();
    expect(mine.map((w) => w.id)).toEqual([acme.id]);
    expect(await userDb(alice.id).membership.count()).toBe(1);
    expect(await systemDb("test").resource.count()).toBe(2);
  });

  it("rejects malformed scope ids (no SQL injection through the scope)", async () => {
    expect(() => tenantDb({ workspaceId: "x'; DROP TABLE resource; --" })).toThrow(
      /Invalid database scope id/,
    );
    expect(await adminDb().resource.count()).toBe(0);
  });
});
