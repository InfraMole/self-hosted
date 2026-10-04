// SPDX-License-Identifier: AGPL-3.0-only
/** Retention of paused Cloud workspaces (M32, ADR-046). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getUsage } from "@/server/modules/billing/limits";
import { retirePausedWorkspaces } from "@/server/modules/billing/paused";
import { setMailTransportForTests, type Mail } from "@/server/mail";
import { createWorkspace } from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

const DAY = 86_400_000;
const sent: Mail[] = [];

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
  setMailTransportForTests(async (m) => void sent.push(m));
});
afterAll(async () => {
  setMailTransportForTests(undefined);
  await adminDb().$disconnect();
});

/** A Cloud workspace whose trial ended `daysAgo` days ago, with an owner and a member. */
async function expired(name: string, daysAgo: number) {
  const owner = await createTestUser(`${name} owner`);
  const member = await createTestUser(`${name} member`);
  const ws = await createWorkspace(owner.id, { name });
  await adminDb().membership.create({
    data: { workspaceId: ws.id, userId: member.id, role: "MEMBER" },
  });
  await adminDb().workspace.update({
    where: { id: ws.id },
    data: { trialEndsAt: new Date(Date.now() - daysAgo * DAY) },
  });
  await adminDb().resource.create({ data: { workspaceId: ws.id, name: "SQL01", type: "SERVER" } });
  return { ws, owner };
}

const at = (days: number) => new Date(Date.now() + days * DAY);

describe("paused Cloud workspaces", () => {
  it("starts the clock when first seen paused, warns owners at 30 and 7 days, deletes at 60", async () => {
    const { ws, owner } = await expired("Acme", 1);
    // Trial ended a day ago: paused from now on, nothing deleted.
    expect(await retirePausedWorkspaces(at(0), "cloud")).toMatchObject({ paused: 1, deleted: 0 });
    const since = (await adminDb().workspace.findUniqueOrThrow({ where: { id: ws.id } }))
      .pausedSince!;
    expect((await getUsage(ws.id, "cloud", at(0))).deletesAt).toBe(
      new Date(since.getTime() + 60 * DAY).toISOString(),
    );
    expect(sent).toHaveLength(0);

    expect(await retirePausedWorkspaces(at(31), "cloud")).toMatchObject({ notices: 1 });
    expect(sent.map((m) => m.to)).toEqual([owner.email]); // owners only
    expect(sent[0]!.subject).toBe("“Acme” will be deleted in 29 days");
    expect(sent[0]!.text).toContain(`/w/${ws.slug}/settings/billing`);
    // The same notice is not sent twice.
    expect(await retirePausedWorkspaces(at(32), "cloud")).toMatchObject({ notices: 0 });

    expect(await retirePausedWorkspaces(at(54), "cloud")).toMatchObject({ notices: 1 });
    expect(sent[1]!.subject).toBe("“Acme” will be deleted in 6 days");

    expect(await retirePausedWorkspaces(at(61), "cloud")).toMatchObject({ deleted: 1 });
    expect(await adminDb().workspace.count({ where: { id: ws.id } })).toBe(0);
    expect(await adminDb().resource.count()).toBe(0);
    const audit = await adminDb().auditEvent.findFirstOrThrow({
      where: { action: "workspace.deleted", targetId: ws.id },
    });
    expect(audit).toMatchObject({ actorType: "SYSTEM", workspaceId: null, targetLabel: "Acme" });
  });

  it("a plan stops the clock; a later pause starts a new one", async () => {
    const { ws } = await expired("Acme", 1);
    await retirePausedWorkspaces(at(0), "cloud");
    await retirePausedWorkspaces(at(31), "cloud"); // first notice sent
    await adminDb().workspaceSubscription.create({
      data: { workspaceId: ws.id, stripeCustomerId: "cus_1", status: "active", tier: "team" },
    });
    expect(await retirePausedWorkspaces(at(40), "cloud")).toMatchObject({ resumed: 1 });
    expect(await adminDb().workspace.findUniqueOrThrow({ where: { id: ws.id } })).toMatchObject({
      pausedSince: null,
      pauseNoticesSent: 0,
    });
    // Cancelled a year later: 60 fresh days, not an immediate deletion.
    await adminDb().workspaceSubscription.update({
      where: { workspaceId: ws.id },
      data: { status: "canceled" },
    });
    expect(await retirePausedWorkspaces(at(400), "cloud")).toMatchObject({ paused: 1, deleted: 0 });
    expect(await retirePausedWorkspaces(at(459), "cloud")).toMatchObject({ deleted: 0 });
    expect(await retirePausedWorkspaces(at(461), "cloud")).toMatchObject({ deleted: 1 });
  });

  it("never touches workspaces on a trial, and never deletes outside Cloud", async () => {
    const owner = await createTestUser("Trial owner");
    await createWorkspace(owner.id, { name: "Fresh" }); // trial running
    await expired("Old", 100);
    for (const edition of ["community", "business"] as const)
      expect(await retirePausedWorkspaces(at(500), edition)).toEqual({
        paused: 0,
        resumed: 0,
        notices: 0,
        deleted: 0,
      });
    expect(await adminDb().workspace.count()).toBe(2);
    expect(await retirePausedWorkspaces(at(0), "cloud")).toMatchObject({ paused: 1, deleted: 0 });
    expect(await adminDb().workspace.count()).toBe(2);
  });
});
