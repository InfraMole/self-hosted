// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M35: a private demo — the demo account with its own password and a role
 * that can change things, reset on demand. Env is set before the first read
 * of getEnv() in this file's module registry.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { parseEnv } from "@/server/env";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_SLUG,
  ensureDemo,
  publicDemo,
  writableDemo,
} from "@/server/modules/demo/demo";
import { createResource } from "@/server/modules/resources/resources";
import { findWorkspaceContextForUser } from "@/server/modules/workspaces/workspaces";
import { adminDb, resetDatabase } from "./helpers";

const PRIVATE_PASSWORD = "presenter-only-password-42";
process.env.EDITION = "community";
process.env.SIGNUP = "closed";
process.env.DEMO_MODE = "true";
process.env.DEMO_ROLE = "ADMIN";
process.env.DEMO_PASSWORD = PRIVATE_PASSWORD;
process.env.DEMO_RESET_HOURS = "48";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

const base = process.env.BETTER_AUTH_URL!.replace(/\/$/, "");
const signIn = (password: string) =>
  getAuth().handler(
    new Request(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: DEMO_EMAIL, password }),
    }),
  );

describe("private demo", () => {
  it("refuses a demo that can change things with the public password", () => {
    expect(() =>
      parseEnv({ ...process.env, DEMO_ROLE: "MEMBER", DEMO_PASSWORD: undefined }),
    ).toThrow(/DEMO_PASSWORD/);
    expect(() => parseEnv({ ...process.env, DEMO_PASSWORD: "short" })).toThrow(/12/);
  });

  it("is private and writable: own password, the configured role, no public page", async () => {
    expect(publicDemo()).toBe(false);
    expect(writableDemo()).toBe(true);
    expect(await ensureDemo()).toBe("created");
    expect((await signIn(DEMO_PASSWORD)).status).toBe(401);
    expect((await signIn(PRIVATE_PASSWORD)).status).toBe(200);

    const user = await adminDb().user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    const ctx = (await findWorkspaceContextForUser(user.id, DEMO_SLUG))!;
    expect(ctx.role).toBe("ADMIN");
    await createResource(ctx, { name: "Boss laptop", type: "SERVER" });
    expect(await adminDb().resource.count({ where: { name: "Boss laptop" } })).toBe(1);
  });

  it("keeps changes until the reset period, and a forced reset starts over", async () => {
    await ensureDemo();
    const user = await adminDb().user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
    const ctx = (await findWorkspaceContextForUser(user.id, DEMO_SLUG))!;
    await createResource(ctx, { name: "Temporary", type: "SERVER" });

    const in25h = new Date(Date.now() + 25 * 3_600_000);
    expect(await ensureDemo(in25h)).toBe("fresh"); // DEMO_RESET_HOURS=48
    expect(await adminDb().resource.count({ where: { name: "Temporary" } })).toBe(1);

    expect(await ensureDemo(new Date(), { force: true })).toBe("reset");
    expect(await adminDb().resource.count({ where: { name: "Temporary" } })).toBe(0);
    const again = (await findWorkspaceContextForUser(user.id, DEMO_SLUG))!;
    expect(again.role).toBe("ADMIN");
    expect((await signIn(PRIVATE_PASSWORD)).status).toBe(200);
  });
});
