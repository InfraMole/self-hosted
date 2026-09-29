// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { removePasskey, syncTwoFactorAudit } from "@/server/modules/account/account";
import {
  createWorkspace,
  findWorkspaceContextForUser,
  setRequireTwoFactor,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterAll(() => adminDb().$disconnect());

const PASSWORD = "correct-horse-battery";

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what an authenticator app computes. */
function totp(base32: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function signUpAndSignIn(email: string) {
  await getAuth().api.signUpEmail({ body: { name: "Alice", email, password: PASSWORD } });
  const { headers } = await getAuth().api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

async function enable2fa(headers: Headers) {
  const setup = await getAuth().api.enableTwoFactor({ body: { password: PASSWORD }, headers });
  if (!("totpURI" in setup)) throw new Error("no totp");
  const secret = new URL(setup.totpURI).searchParams.get("secret")!;
  await getAuth().api.verifyTOTP({ body: { code: totp(secret) }, headers });
  return { secret, backupCodes: setup.backupCodes };
}

describe("two-factor authentication", () => {
  it("stores the TOTP secret encrypted and requires the code at sign-in", async () => {
    const headers = await signUpAndSignIn("alice@example.test");
    const { secret, backupCodes } = await enable2fa(headers);
    const user = await adminDb().user.findUniqueOrThrow({
      where: { email: "alice@example.test" },
      include: { twoFactors: true },
    });
    expect(user.twoFactorEnabled).toBe(true);
    expect(backupCodes).toHaveLength(10);
    const stored = JSON.stringify(user.twoFactors);
    expect(stored).not.toContain(secret);
    for (const code of backupCodes) expect(stored).not.toContain(code);

    const second = await getAuth().api.signInEmail({
      body: { email: "alice@example.test", password: PASSWORD },
    });
    expect(second).toMatchObject({ twoFactorRedirect: true });
    expect("token" in second && second.token).toBeFalsy();
  });

  it("audits enable/disable once per real change", async () => {
    const headers = await signUpAndSignIn("bob@example.test");
    const user = await adminDb().user.findUniqueOrThrow({ where: { email: "bob@example.test" } });
    await syncTwoFactorAudit(user.id); // nothing happened yet → nothing recorded
    await enable2fa(headers);
    await syncTwoFactorAudit(user.id);
    await syncTwoFactorAudit(user.id); // idempotent
    const actions = (
      await adminDb().auditEvent.findMany({
        where: { actorId: user.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((e) => e.action);
    expect(actions.filter((a) => a.startsWith("auth.two_factor"))).toEqual([
      "auth.two_factor_enabled",
    ]);
  });
});

describe("workspace 2FA policy", () => {
  it("can only be required by an owner who has 2FA, and is exposed on the context", async () => {
    const headers = await signUpAndSignIn("owner@example.test");
    const owner = await adminDb().user.findUniqueOrThrow({
      where: { email: "owner@example.test" },
    });
    const ws = await createWorkspace(owner.id, { name: "Acme" });
    const ctx = (await findWorkspaceContextForUser(owner.id, ws.slug))!;
    await expect(setRequireTwoFactor(ctx, true)).rejects.toThrow(/your own account first/);

    await enable2fa(headers);
    await setRequireTwoFactor(ctx, true);
    expect((await findWorkspaceContextForUser(owner.id, ws.slug))!.requireTwoFactor).toBe(true);

    const admin = await createTestUser("Admin");
    await adminDb().membership.create({
      data: { workspaceId: ws.id, userId: admin.id, role: "ADMIN" },
    });
    const actx = (await findWorkspaceContextForUser(admin.id, ws.slug))!;
    await expect(setRequireTwoFactor(actx, false)).rejects.toThrow();
    const audit = await adminDb().auditEvent.findFirst({
      where: { action: "workspace.settings_changed" },
    });
    expect(audit?.metadata).toEqual({ requireTwoFactor: true });
  });
});

describe("passkeys", () => {
  it("a user can only remove their own passkeys", async () => {
    const alice = await createTestUser("Alice");
    const mallory = await createTestUser("Mallory");
    const key = await adminDb().passkey.create({
      data: {
        id: "pk1",
        name: "MacBook",
        publicKey: "pub",
        userId: alice.id,
        credentialID: "cred",
        counter: 0,
        deviceType: "multiDevice",
        backedUp: true,
      },
    });
    await expect(removePasskey(mallory.id, key.id)).rejects.toThrow(/not found/);
    await removePasskey(alice.id, key.id);
    expect(await adminDb().passkey.count()).toBe(0);
    expect(
      await adminDb().auditEvent.findFirst({ where: { action: "auth.passkey_removed" } }),
    ).toMatchObject({ actorId: alice.id, targetLabel: "MacBook" });
  });
});
