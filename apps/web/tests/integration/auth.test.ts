// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { adminDb, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

describe("auth", () => {
  it("stores only a password hash", async () => {
    const password = "correct-horse-battery";
    await getAuth().api.signUpEmail({
      body: { name: "Alice", email: "alice@example.test", password },
    });

    const account = await adminDb().account.findFirstOrThrow({
      where: { user: { email: "alice@example.test" } },
    });
    expect(account.providerId).toBe("credential");
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(password);
  });

  it("rejects passwords shorter than the minimum", async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { name: "Bob", email: "bob@example.test", password: "short" },
      }),
    ).rejects.toThrow();
    expect(await adminDb().user.count()).toBe(0);
  });

  it("rejects wrong credentials", async () => {
    await getAuth().api.signUpEmail({
      body: { name: "Carol", email: "carol@example.test", password: "a-long-enough-password" },
    });
    await expect(
      getAuth().api.signInEmail({
        body: { email: "carol@example.test", password: "wrong-password-123" },
      }),
    ).rejects.toThrow();
  });
});
