// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M13: invite-only sign-up (SIGNUP=closed) and the public demo (DEMO_MODE).
 * Env is set before the first read of getEnv() in this file's module registry.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/authz";
import { getAuth } from "@/server/auth";
import { SIGNUP_CLOSED_MESSAGE } from "@/server/modules/access/signup";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_SLUG, ensureDemo } from "@/server/modules/demo/demo";
import { MemberError, createInvitation, removeMember } from "@/server/modules/members/members";
import { createResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, resetDatabase } from "./helpers";

process.env.EDITION = "community";
process.env.SIGNUP = "closed";
process.env.DEMO_MODE = "true";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

const signUp = (name: string, email: string) =>
  getAuth().api.signUpEmail({ body: { name, email, password: "correct-horse-battery" } });

describe("SIGNUP=closed", () => {
  it("lets the first user in, refuses strangers, accepts invited addresses", async () => {
    await ensureDemo(); // the demo account never counts as "the first user"
    await signUp("Owner", "owner@example.test");
    await expect(signUp("Stranger", "stranger@example.test")).rejects.toThrow(
      SIGNUP_CLOSED_MESSAGE,
    );
    expect(await adminDb().user.count({ where: { email: "stranger@example.test" } })).toBe(0);

    const owner = await adminDb().user.findUniqueOrThrow({
      where: { email: "owner@example.test" },
    });
    const ws = await createWorkspace(owner.id, { name: "Acme" });
    const ctx = (await findWorkspaceContextForUser(owner.id, ws.slug))!;
    await createInvitation(ctx, { email: "Invited@Example.test", role: "MEMBER" });
    await signUp("Invited", "invited@example.test");
    expect(await adminDb().user.count({ where: { email: "invited@example.test" } })).toBe(1);
  });
});

describe("DEMO_MODE", () => {
  it("builds the demo once, keeps it for 24 h, then rebuilds it", async () => {
    expect(await ensureDemo()).toBe("created");
    const first = await adminDb().workspace.findUniqueOrThrow({ where: { slug: DEMO_SLUG } });
    expect(await adminDb().resource.count({ where: { workspaceId: first.id } })).toBeGreaterThan(
      15,
    );
    expect(
      await adminDb().relationship.count({
        where: { workspaceId: first.id, status: "UNCONFIRMED" },
      }),
    ).toBeGreaterThan(0); // suggestions to show
    const member = await adminDb().membership.findFirstOrThrow({
      where: { workspaceId: first.id },
      include: { user: true },
    });
    expect(member).toMatchObject({ role: "VIEWER", user: { email: DEMO_EMAIL } });
    expect(await ensureDemo()).toBe("fresh");

    await adminDb().workspace.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(await ensureDemo()).toBe("reset");
    const second = await adminDb().workspace.findUniqueOrThrow({ where: { slug: DEMO_SLUG } });
    expect(second.id).not.toBe(first.id);
    expect(await adminDb().user.count({ where: { email: DEMO_EMAIL } })).toBe(1);
  });

  it("the shared demo account is read-only", async () => {
    await ensureDemo();
    const signIn = await getAuth().api.signInEmail({
      body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      returnHeaders: true,
    });
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;
    const headers = new Headers({ cookie });

    await expect(
      getAuth().api.changePassword({
        body: { currentPassword: DEMO_PASSWORD, newPassword: "taken-over-123456" },
        headers,
      }),
    ).rejects.toThrow(/read-only/);
    await expect(getAuth().api.updateUser({ body: { name: "Pwned" }, headers })).rejects.toThrow(
      /read-only/,
    );
    await expect(getAuth().api.deleteUser({ body: {}, headers })).rejects.toThrow(/read-only/);
    await expect(
      getAuth().api.requestPasswordReset({ body: { email: DEMO_EMAIL, redirectTo: "/" } }),
    ).rejects.toThrow(/read-only/);
    // Still signs in with the public password.
    await getAuth().api.signInEmail({ body: { email: DEMO_EMAIL, password: DEMO_PASSWORD } });
    // Anonymous visitors: no account-level sign-in trail with their IP.
    expect(await adminDb().auditEvent.count({ where: { action: "auth.sign_in" } })).toBe(0);

    const demoUser = await adminDb().user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    const ctx = (await findWorkspaceContextForUser(demoUser.id, DEMO_SLUG))!;
    await expect(removeMember(ctx, demoUser.id)).rejects.toBeInstanceOf(MemberError);
    await expect(createResource(ctx, { name: "graffiti", type: "SERVER" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
