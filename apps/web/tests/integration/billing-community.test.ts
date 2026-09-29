// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Community edition (ADR-024): free and open source, UNLIMITED servers/VMs,
 * one workspace per installation. Business without a valid licence behaves
 * like Community.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  InstanceWorkspaceLimitError,
  assertCanCreateWorkspace,
  getUsage,
} from "@/server/modules/billing/limits";
import { applyImport } from "@/server/modules/importers/importers";
import { createResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

process.env.EDITION = "community";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

describe("Community edition", () => {
  it("has no server/VM limit", async () => {
    const alice = await createTestUser("Alice");
    const ws = await createWorkspace(alice.id, { name: "A" });
    const ctx = (await findWorkspaceContextForUser(alice.id, ws.slug))!;
    await adminDb().resource.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        workspaceId: ctx.workspaceId,
        name: `seed-${i}`,
        type: "SERVER" as const,
      })),
    });
    await createResource(ctx, { name: "one-more", type: "VM" });
    const csv = ["name,type", ...Array.from({ length: 50 }, (_, i) => `imp-${i},server`)].join(
      "\n",
    );
    await applyImport(ctx, { text: csv, format: "csv" });
    expect(await getUsage(ctx.workspaceId)).toMatchObject({
      plan: "community",
      scope: "instance",
      nodes: 351,
      limit: null,
      memberLimit: null,
      paused: false,
    });
  });

  it("allows one workspace per installation (onboarding checks before creating)", async () => {
    await assertCanCreateWorkspace(); // none yet
    const alice = await createTestUser("Alice");
    await createWorkspace(alice.id, { name: "A" });
    await expect(assertCanCreateWorkspace()).rejects.toBeInstanceOf(InstanceWorkspaceLimitError);
    await expect(assertCanCreateWorkspace("business")).rejects.toBeInstanceOf(
      InstanceWorkspaceLimitError,
    ); // no valid licence in tests → Community rules
    await assertCanCreateWorkspace("cloud"); // Cloud: no instance limit
  });
});
