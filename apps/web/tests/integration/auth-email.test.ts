// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email verification, password reset and invitation binding with a mailer
 * configured. The capture transport must be set before getAuth() is first
 * called (verification is required only when mail can really be sent).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { setMailTransportForTests, type Mail } from "@/server/mail";
import { acceptInvitation, createInvitation } from "@/server/modules/members/members";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

const outbox: Mail[] = [];
beforeAll(() => setMailTransportForTests(async (m) => void outbox.push(m)));
beforeEach(async () => {
  outbox.length = 0;
  await resetDatabase();
});
afterAll(async () => {
  setMailTransportForTests(undefined);
  await adminDb().$disconnect();
});

const linkIn = (mail: Mail) => mail.text.match(/https?:\/\/\S+/)![0];
const PASSWORD = "correct-horse-battery";

async function signUp(email: string) {
  return getAuth().api.signUpEmail({
    body: { name: "Alice\nBcc: evil", email, password: PASSWORD },
  });
}

describe("email verification", () => {
  it("requires verifying the address before signing in", async () => {
    const res = await signUp("alice@example.test");
    expect(res.token).toBeNull();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("alice@example.test");
    expect(outbox[0]!.subject).toMatch(/Verify/);
    expect(outbox[0]!.text).not.toMatch(/\nBcc:/); // names cannot inject headers/lines

    await expect(
      getAuth().api.signInEmail({ body: { email: "alice@example.test", password: PASSWORD } }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const token = new URL(linkIn(outbox[0]!)).searchParams.get("token")!;
    await getAuth().api.verifyEmail({ query: { token } });
    expect(
      (await adminDb().user.findUniqueOrThrow({ where: { email: "alice@example.test" } }))
        .emailVerified,
    ).toBe(true);
    const signedIn = await getAuth().api.signInEmail({
      body: { email: "alice@example.test", password: PASSWORD },
    });
    expect(signedIn.token).toBeTruthy();
  });
});

describe("password reset", () => {
  it("resets with the emailed token, revokes sessions, and never reveals unknown emails", async () => {
    await signUp("bob@example.test");
    await adminDb().user.update({
      where: { email: "bob@example.test" },
      data: { emailVerified: true },
    });
    await getAuth().api.signInEmail({ body: { email: "bob@example.test", password: PASSWORD } });
    expect(await adminDb().session.count()).toBe(1);
    outbox.length = 0;

    const unknown = await getAuth().api.requestPasswordReset({
      body: { email: "nobody@example.test", redirectTo: "/reset-password" },
    });
    const known = await getAuth().api.requestPasswordReset({
      body: { email: "bob@example.test", redirectTo: "/reset-password" },
    });
    expect(unknown).toEqual(known); // same answer either way
    expect(outbox.map((m) => m.to)).toEqual(["bob@example.test"]);

    const token = new URL(linkIn(outbox[0]!)).pathname.split("/").pop()!;
    await getAuth().api.resetPassword({ body: { newPassword: "a-brand-new-password", token } });
    expect(await adminDb().session.count()).toBe(0);
    await expect(
      getAuth().api.signInEmail({ body: { email: "bob@example.test", password: PASSWORD } }),
    ).rejects.toThrow();
    expect(
      (
        await getAuth().api.signInEmail({
          body: { email: "bob@example.test", password: "a-brand-new-password" },
        })
      ).token,
    ).toBeTruthy();
    // Single use.
    await expect(
      getAuth().api.resetPassword({ body: { newPassword: "another-password-123", token } }),
    ).rejects.toThrow();
  });
});

describe("invitations with a mailer", () => {
  it("require a verified email to accept", async () => {
    const owner = await createTestUser("Owner");
    const ws = await createWorkspace(owner.id, { name: "Acme" });
    const ctx = (await findWorkspaceContextForUser(owner.id, ws.slug))!;
    const invitee = await createTestUser("Invitee");
    const { token } = await createInvitation(ctx, { email: invitee.email, role: "MEMBER" });
    await expect(acceptInvitation(invitee, token, { requireVerifiedEmail: true })).rejects.toThrow(
      /Verify your email/,
    );
    await adminDb().user.update({ where: { id: invitee.id }, data: { emailVerified: true } });
    await expect(
      acceptInvitation({ ...invitee, emailVerified: true }, token, { requireVerifiedEmail: true }),
    ).resolves.toEqual({ slug: ws.slug });
  });
});
