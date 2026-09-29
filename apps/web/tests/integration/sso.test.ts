// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SSO configuration (M8c). The providers must be configured before the auth
 * singleton is created, so env is set at module load of this file (each test
 * file has its own module registry).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enabledSsoProviders, getAuth } from "@/server/auth";
import { parseEnv } from "@/server/env";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

process.env.GOOGLE_CLIENT_ID = "google-client-id-123";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-123";
process.env.MICROSOFT_CLIENT_ID = "microsoft-client-id-123";
process.env.MICROSOFT_CLIENT_SECRET = "microsoft-client-secret-123";
process.env.MICROSOFT_TENANT_ID = "organizations";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

describe("SSO providers", () => {
  it("are enabled only when both id and secret are set", () => {
    const base = { ...process.env };
    expect(enabledSsoProviders(parseEnv({ ...base, GOOGLE_CLIENT_SECRET: "" }))).toEqual([
      "microsoft",
    ]);
    expect(enabledSsoProviders(parseEnv({ ...base, MICROSOFT_CLIENT_ID: "" }))).toEqual(["google"]);
    expect(enabledSsoProviders()).toEqual(["google", "microsoft"]);
  });

  it("redirect to the provider with state, scopes and the configured tenant", async () => {
    const google = await getAuth().api.signInSocial({
      body: { provider: "google", callbackURL: "/" },
    });
    const g = new URL(google.url!);
    expect(g.hostname).toBe("accounts.google.com");
    expect(g.searchParams.get("client_id")).toBe("google-client-id-123");
    expect(g.searchParams.get("state")).toBeTruthy();
    expect(g.searchParams.get("scope")).toContain("email");

    const ms = await getAuth().api.signInSocial({
      body: { provider: "microsoft", callbackURL: "/" },
    });
    const m = new URL(ms.url!);
    expect(m.hostname).toBe("login.microsoftonline.com");
    expect(m.pathname).toContain("/organizations/");
    // PKCE: the code verifier never travels in the URL, only its challenge.
    expect(m.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("rejects an open redirect as callback", async () => {
    // Through the real HTTP handler (origin/callback checks run there).
    const base = process.env.BETTER_AUTH_URL!.replace(/\/$/, "");
    const call = (callbackURL: string) =>
      getAuth().handler(
        new Request(`${base}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ provider: "google", callbackURL }),
        }),
      );
    expect((await call("/w/acme/library")).status).toBe(200);
    expect((await call("https://evil.example/")).status).toBe(403);
  });

  it("audits a newly connected sign-in method", async () => {
    const user = await createTestUser("Alice");
    const ctx = await getAuth().$context;
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "google",
      accountId: "g-123",
    });
    const event = await adminDb().auditEvent.findFirst({
      where: { action: "auth.sign_in_method_added" },
    });
    expect(event).toMatchObject({
      actorId: user.id,
      workspaceId: null,
      metadata: { provider: "google" },
    });
  });
});
