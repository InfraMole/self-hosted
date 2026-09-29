// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  listInvitations,
  listMembers,
  previewInvitation,
  removeMember,
  revokeInvitation,
} from "@/server/modules/members/members";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

async function addMember(owner: WorkspaceContext, role: Role) {
  const user = await createTestUser(`${role} user`);
  await adminDb().membership.create({
    data: { workspaceId: owner.workspaceId, userId: user.id, role },
  });
  return (await findWorkspaceContextForUser(user.id, owner.workspaceSlug))!;
}

describe("invitations", () => {
  it("stores only a hash, and the invited email can accept exactly once", async () => {
    const owner = await ownerContext("Acme");
    const invitee = await createTestUser("Bob");
    const { token } = await createInvitation(owner, {
      email: ` ${invitee.email.toUpperCase()} `,
      role: "MEMBER",
    });
    expect(token).toMatch(/^dmp_inv_/);
    const row = await adminDb().invitation.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.email).toBe(invitee.email);

    expect(await previewInvitation(token)).toMatchObject({
      state: "pending",
      workspaceName: "Acme",
      role: "MEMBER",
    });
    expect((await previewInvitation(token))!.emailHint).not.toBe(invitee.email);

    // Someone else holding the link cannot use it.
    const mallory = await createTestUser("Mallory");
    await expect(acceptInvitation(mallory, token)).rejects.toThrow(/Sign in with that email/);

    expect(await acceptInvitation(invitee, token)).toEqual({ slug: owner.workspaceSlug });
    expect((await findWorkspaceContextForUser(invitee.id, owner.workspaceSlug))!.role).toBe(
      "MEMBER",
    );
    // Idempotent for the same user, rejected for anyone else.
    expect(await acceptInvitation(invitee, token)).toEqual({ slug: owner.workspaceSlug });
    expect((await previewInvitation(token))!.state).toBe("accepted");
    expect(await listInvitations(owner)).toEqual([]);
  });

  it("rejects unknown, revoked, expired and replaced tokens", async () => {
    const owner = await ownerContext("Acme");
    const invitee = await createTestUser("Bob");
    expect(await previewInvitation("dmp_inv_" + "a".repeat(43))).toBeNull();
    expect(await previewInvitation("garbage")).toBeNull();

    const first = await createInvitation(owner, { email: invitee.email, role: "VIEWER" });
    const second = await createInvitation(owner, { email: invitee.email, role: "MEMBER" });
    await expect(acceptInvitation(invitee, first.token)).rejects.toThrow(/revoked/);

    await revokeInvitation(owner, second.id);
    await expect(acceptInvitation(invitee, second.token)).rejects.toThrow(/revoked/);

    const third = await createInvitation(owner, { email: invitee.email, role: "MEMBER" });
    await adminDb().invitation.update({
      where: { id: third.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(acceptInvitation(invitee, third.token)).rejects.toThrow(/expired/);
    expect(await findWorkspaceContextForUser(invitee.id, owner.workspaceSlug)).toBeNull();
  });

  it("enforces who can invite and which roles", async () => {
    const owner = await ownerContext("Acme");
    const admin = await addMember(owner, "ADMIN");
    const member = await addMember(owner, "MEMBER");
    await expect(
      createInvitation(member, { email: "x@example.test", role: "VIEWER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createInvitation(admin, { email: "x@example.test", role: "OWNER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createInvitation(admin, { email: "not-an-email", role: "MEMBER" }),
    ).rejects.toThrow();
    await expect(
      createInvitation(admin, {
        email: (await adminDb().user.findUniqueOrThrow({ where: { id: member.userId } })).email,
        role: "ADMIN",
      }),
    ).rejects.toThrow(/already a member/);
    await expect(listInvitations(member)).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await createInvitation(admin, { email: "x@example.test", role: "ADMIN" })).token,
    ).toBeTruthy();
  });

  it("cannot be used to reach or revoke another workspace's invitations", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const inv = await createInvitation(acme, { email: "x@example.test", role: "MEMBER" });
    await expect(revokeInvitation(globex, inv.id)).rejects.toThrow(/not found/);
    expect(await listInvitations(globex)).toEqual([]);
  });

  it("never downgrades an existing member who accepts a lower invitation", async () => {
    const owner = await ownerContext("Acme");
    const admin = await addMember(owner, "ADMIN");
    const email = (await adminDb().user.findUniqueOrThrow({ where: { id: admin.userId } })).email;
    await adminDb().membership.delete({
      where: { workspaceId_userId: { workspaceId: owner.workspaceId, userId: admin.userId } },
    });
    const { token } = await createInvitation(owner, { email, role: "VIEWER" });
    await adminDb().membership.create({
      data: { workspaceId: owner.workspaceId, userId: admin.userId, role: "ADMIN" },
    });
    await acceptInvitation({ id: admin.userId, email }, token);
    expect((await findWorkspaceContextForUser(admin.userId, owner.workspaceSlug))!.role).toBe(
      "ADMIN",
    );
  });
});

describe("members", () => {
  it("lists members for any role; ADMIN changes roles but not owners", async () => {
    const owner = await ownerContext("Acme");
    const admin = await addMember(owner, "ADMIN");
    const viewer = await addMember(owner, "VIEWER");
    expect((await listMembers(viewer)).map((m) => m.role)).toEqual(["OWNER", "ADMIN", "VIEWER"]);

    await changeMemberRole(admin, viewer.userId, "MEMBER");
    await expect(changeMemberRole(admin, viewer.userId, "OWNER")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(changeMemberRole(admin, owner.userId, "MEMBER")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(changeMemberRole(viewer, admin.userId, "VIEWER")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("always keeps at least one owner", async () => {
    const owner = await ownerContext("Acme");
    const other = await addMember(owner, "MEMBER");
    await expect(changeMemberRole(owner, owner.userId, "ADMIN")).rejects.toThrow(
      /at least one owner/,
    );
    await expect(removeMember(owner, owner.userId)).rejects.toThrow(/at least one owner/);
    await changeMemberRole(owner, other.userId, "OWNER");
    await changeMemberRole(owner, owner.userId, "ADMIN"); // now allowed
    expect((await listMembers(owner)).filter((m) => m.role === "OWNER")).toHaveLength(1);
  });

  it("ADMIN removes members, anyone can leave, nobody touches other workspaces", async () => {
    const owner = await ownerContext("Acme");
    const admin = await addMember(owner, "ADMIN");
    const member = await addMember(owner, "MEMBER");
    const viewer = await addMember(owner, "VIEWER");
    await expect(removeMember(member, viewer.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await removeMember(viewer, viewer.userId); // leave
    await removeMember(admin, member.userId);
    await expect(removeMember(admin, owner.userId)).rejects.toBeInstanceOf(ForbiddenError);

    const globex = await ownerContext("Globex");
    await expect(removeMember(globex, admin.userId)).rejects.toThrow(/not found/);
    await expect(changeMemberRole(globex, admin.userId, "VIEWER")).rejects.toThrow(/not found/);
    expect((await listMembers(owner)).map((m) => m.role)).toEqual(["OWNER", "ADMIN"]);
  });
});
