// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_OWNED_WORKSPACES,
  WorkspaceLimitError,
  createWorkspace,
  deleteWorkspace,
  findWorkspaceContextForUser,
  listWorkspacesForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

describe("workspace tenancy isolation", () => {
  it("resolves a context for members only", async () => {
    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    const acme = await createWorkspace(alice.id, { name: "Acme" });

    const aliceCtx = await findWorkspaceContextForUser(alice.id, acme.slug);
    expect(aliceCtx).toMatchObject({
      workspaceId: acme.id,
      workspaceSlug: acme.slug,
      userId: alice.id,
      role: "OWNER",
    });

    // Bob is not a member: indistinguishable from "does not exist".
    expect(await findWorkspaceContextForUser(bob.id, acme.slug)).toBeNull();
    expect(await findWorkspaceContextForUser(bob.id, "does-not-exist")).toBeNull();
  });

  it("never lists another user's workspaces", async () => {
    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    await createWorkspace(alice.id, { name: "Alice Infra" });
    const bobWs = await createWorkspace(bob.id, { name: "Bob Infra" });

    const bobList = await listWorkspacesForUser(bob.id);
    expect(bobList.map((w) => w.id)).toEqual([bobWs.id]);
  });

  it("rejects malformed slugs without querying membership", async () => {
    const alice = await createTestUser();
    await createWorkspace(alice.id, { name: "Acme" });
    for (const slug of ["", "A", "acme'; --", "../acme", "ACME", "x".repeat(49)]) {
      expect(await findWorkspaceContextForUser(alice.id, slug)).toBeNull();
    }
  });

  it("reflects the membership role in the context", async () => {
    const owner = await createTestUser("Owner");
    const viewer = await createTestUser("Viewer");
    const ws = await createWorkspace(owner.id, { name: "Shared" });
    await adminDb().membership.create({
      data: { workspaceId: ws.id, userId: viewer.id, role: "VIEWER" },
    });

    const ctx = await findWorkspaceContextForUser(viewer.id, ws.slug);
    expect(ctx?.role).toBe("VIEWER");
  });

  it("cascades memberships when a workspace is deleted", async () => {
    const alice = await createTestUser();
    const ws = await createWorkspace(alice.id, { name: "Temp" });
    const ctx = (await findWorkspaceContextForUser(alice.id, ws.slug))!;
    // Direct deletion is refused: the workspace's audit rows are append-only.
    await expect(adminDb().workspace.delete({ where: { id: ws.id } })).rejects.toThrow(/365 days/);
    await deleteWorkspace(ctx, "Temp");
    expect(await adminDb().membership.count({ where: { workspaceId: ws.id } })).toBe(0);
    expect(await findWorkspaceContextForUser(alice.id, ws.slug)).toBeNull();
  });
});

describe("createWorkspace", () => {
  it("makes the creator OWNER and resolves slug collisions", async () => {
    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    const a = await createWorkspace(alice.id, { name: "Acme Corp" });
    const b = await createWorkspace(bob.id, { name: "Acme Corp" });

    expect(a.slug).toBe("acme-corp");
    expect(b.slug).toMatch(/^acme-corp-[0-9a-f]{6}$/);
    expect(a.role).toBe("OWNER");

    const membership = await adminDb().membership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: b.id, userId: bob.id } },
    });
    expect(membership.role).toBe("OWNER");
  });

  it("validates the name", async () => {
    const alice = await createTestUser();
    await expect(createWorkspace(alice.id, { name: "   " })).rejects.toThrow();
    await expect(createWorkspace(alice.id, { name: "x".repeat(65) })).rejects.toThrow();
  });

  it("enforces the owned-workspace limit", async () => {
    const alice = await createTestUser();
    await adminDb().workspace.createMany({
      data: Array.from({ length: MAX_OWNED_WORKSPACES }, (_, i) => ({
        id: `ws-limit-${i}`,
        name: `W${i}`,
        slug: `limit-${i}`,
      })),
    });
    await adminDb().membership.createMany({
      data: Array.from({ length: MAX_OWNED_WORKSPACES }, (_, i) => ({
        workspaceId: `ws-limit-${i}`,
        userId: alice.id,
        role: "OWNER" as const,
      })),
    });
    await expect(createWorkspace(alice.id, { name: "One too many" })).rejects.toBeInstanceOf(
      WorkspaceLimitError,
    );
  });
});
