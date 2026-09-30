// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/digest/unsubscribe/route";
import type { WorkspaceContext } from "@/server/authz";
import { type Mail, setMailTransportForTests } from "@/server/mail";
import {
  listDigestPreferences,
  sendDueDigests,
  setWeeklyDigest,
  unsubscribeUrl,
} from "@/server/modules/digest/digest";
import { createResource, updateResource } from "@/server/modules/resources/resources";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

/** M21 (ADR-032): weekly change digest. */

let outbox: Mail[] = [];
beforeEach(async () => {
  await resetDatabase();
  outbox = [];
  setMailTransportForTests(async (m) => {
    outbox.push(m);
  });
});
afterEach(() => setMailTransportForTests(undefined));
afterAll(() => adminDb().$disconnect());

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

const DAY = 86_400_000;
/** Pretend the changes happened last week. */
async function ageEvents(ctx: WorkspaceContext, when: Date) {
  await adminDb().changeEvent.updateMany({
    where: { workspaceId: ctx.workspaceId },
    data: { occurredAt: when },
  });
}

describe("weekly digest", () => {
  it("is opt-in, waits for the next Monday, then summarises the week once", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const sql = await createResource(acme, { name: "SQL01", type: "SERVER" });
    await updateResource(acme, sql.id, { name: "SQL01", type: "SERVER", notes: "Primary DB" });
    await createResource(acme, { name: "APP01", type: "SERVER" });
    await createResource(globex, { name: "SECRET-GLOBEX", type: "SERVER" });

    expect((await listDigestPreferences(acme.userId))[0]).toMatchObject({ weeklyDigest: false });
    const turnedOn = new Date("2026-09-30T10:00:00Z"); // Wednesday
    await setWeeklyDigest(acme, true);
    await adminDb().membership.updateMany({
      where: { workspaceId: acme.workspaceId },
      data: { digestSentAt: turnedOn },
    });
    await ageEvents(acme, new Date("2026-10-01T09:00:00Z"));
    await ageEvents(globex, new Date("2026-10-01T09:00:00Z"));

    // Same week: nothing. Globex never opted in: nothing either.
    expect(await sendDueDigests(new Date("2026-10-02T10:00:00Z"))).toMatchObject({ sent: 0 });

    const monday = new Date("2026-10-05T06:15:00Z");
    expect(await sendDueDigests(monday)).toMatchObject({ sent: 1, failed: 0 });
    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail!.to).toMatch(/@/);
    expect(mail!.subject).toBe("Acme: 3 changes this week");
    expect(mail!.text).toContain("  • 2 created");
    expect(mail!.text).toContain("  • 1 updated");
    expect(mail!.text).toContain("  • SQL01 — 2 changes");
    expect(mail!.text).not.toContain("SECRET-GLOBEX"); // other tenants never leak
    expect(mail!.unsubscribeUrl).toMatch(/\/api\/digest\/unsubscribe\?m=.+&t=/);

    // Idempotent within the week.
    expect(await sendDueDigests(new Date("2026-10-05T09:00:00Z"))).toMatchObject({ sent: 0 });
    // A quiet week: no email, but the week counts as done.
    expect(await sendDueDigests(new Date(monday.getTime() + 7 * DAY))).toMatchObject({
      sent: 0,
      empty: 1,
    });
    expect(outbox).toHaveLength(1);
  });

  it("unsubscribes with the signed link only on POST", async () => {
    const acme = await ownerContext("Acme");
    await setWeeklyDigest(acme, true);
    const membership = await adminDb().membership.findFirstOrThrow({
      where: { workspaceId: acme.workspaceId },
    });
    const url = unsubscribeUrl(membership.id);

    // A GET (link scanner, person clicking) only shows the confirmation page.
    const get = await unsubscribeGet(new Request(url));
    expect(get.status).toBe(303);
    expect(get.headers.get("location")).toContain("/digest/unsubscribe?m=");
    expect(
      (await adminDb().membership.findUniqueOrThrow({ where: { id: membership.id } })).weeklyDigest,
    ).toBe(true);

    // A forged token does nothing.
    const forged = await unsubscribePost(
      new Request(url.replace(/t=[^&]+/, "t=forged"), { method: "POST" }),
    );
    expect(forged.status).toBe(400);

    // One-click (RFC 8058) POST from the mail client.
    const ok = await unsubscribePost(new Request(url, { method: "POST" }));
    expect(ok.status).toBe(200);
    expect(
      (await adminDb().membership.findUniqueOrThrow({ where: { id: membership.id } })).weeklyDigest,
    ).toBe(false);
  });

  it("does nothing without a mail server", async () => {
    setMailTransportForTests(undefined);
    const acme = await ownerContext("Acme");
    await setWeeklyDigest(acme, true);
    expect(await sendDueDigests(new Date("2026-10-12T07:00:00Z"))).toEqual({
      sent: 0,
      empty: 0,
      failed: 0,
      skipped: "mail not configured",
    });
  });
});
