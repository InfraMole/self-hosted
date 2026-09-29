// SPDX-License-Identifier: AGPL-3.0-only
/** Cloud sign-up records which Terms of Service version was accepted (M12). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/lib/legal";
import { getAuth } from "@/server/auth";
import { adminDb, resetDatabase } from "./helpers";

process.env.EDITION = "cloud";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

describe("terms acceptance", () => {
  it("records the version and time on every new Cloud account", async () => {
    const before = Date.now();
    await getAuth().api.signUpEmail({
      body: { name: "Alice", email: "alice@example.test", password: "correct-horse-battery" },
    });
    const user = await adminDb().user.findUniqueOrThrow({ where: { email: "alice@example.test" } });
    expect(user.termsVersion).toBe(TERMS_VERSION);
    expect(user.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("cannot be set or forged by the client", async () => {
    await getAuth()
      .api.signUpEmail({
        body: {
          name: "Mallory",
          email: "mallory@example.test",
          password: "correct-horse-battery",
          termsVersion: "1999-01-01",
          termsAcceptedAt: new Date(0),
        } as never,
      })
      .catch(() => undefined); // rejected or ignored — either way not stored
    const user = await adminDb().user.findUnique({ where: { email: "mallory@example.test" } });
    if (user) {
      expect(user.termsVersion).toBe(TERMS_VERSION);
      expect(user.termsAcceptedAt!.getTime()).toBeGreaterThan(0);
    }
  });
});
