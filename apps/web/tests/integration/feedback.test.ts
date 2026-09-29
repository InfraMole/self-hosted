// SPDX-License-Identifier: AGPL-3.0-only
/** In-app feedback (M12): emailed, not stored; any member; rate limited. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/server/authz";
import { setMailTransportForTests, type Mail } from "@/server/mail";
import { FEEDBACK_PER_HOUR, FeedbackError, sendFeedback } from "@/server/modules/feedback/feedback";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

process.env.FEEDBACK_EMAIL = "team@inframole.test";

const sent: Mail[] = [];
beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  sent.length = 0;
  setMailTransportForTests(async (m) => {
    sent.push(m);
  });
});
afterAll(async () => {
  setMailTransportForTests(undefined);
  await adminDb().$disconnect();
});

async function viewer(): Promise<{ ctx: WorkspaceContext; user: { name: string; email: string } }> {
  const owner = await createTestUser("Owner");
  const ws = await createWorkspace(owner.id, { name: "Acme" });
  const user = await createTestUser("Vera");
  await adminDb().membership.create({
    data: { workspaceId: ws.id, userId: user.id, role: "VIEWER" },
  });
  return { ctx: (await findWorkspaceContextForUser(user.id, ws.slug))!, user };
}

describe("feedback", () => {
  it("emails the team with the sender as Reply-To; viewers can send", async () => {
    const { ctx, user } = await viewer();
    await sendFeedback(ctx, user, {
      kind: "idea",
      message: "Show IIS sites\nplease",
      page: "/w/acme/map",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "team@inframole.test",
      replyTo: user.email,
      subject: `[feedback/idea] ${ctx.workspaceSlug}`,
    });
    expect(sent[0]!.text).toContain("Page: /w/acme/map");
    expect(sent[0]!.text).toContain("Show IIS sites\nplease");
  });

  it("drops anything that is not a plain path as the page, and validates the message", async () => {
    const { ctx, user } = await viewer();
    await sendFeedback(ctx, user, {
      kind: "problem",
      message: "Broken",
      page: "https://evil.test/?token=x",
    });
    expect(sent[0]!.text).toContain("Page: —");
    await expect(sendFeedback(ctx, user, { kind: "other", message: " " })).rejects.toThrow();
  });

  it("is rate limited per user", async () => {
    const { ctx, user } = await viewer();
    for (let i = 0; i < FEEDBACK_PER_HOUR; i++)
      await sendFeedback(ctx, user, { kind: "other", message: `note ${i}` });
    await expect(
      sendFeedback(ctx, user, { kind: "other", message: "one more" }),
    ).rejects.toBeInstanceOf(FeedbackError);
    expect(sent).toHaveLength(FEEDBACK_PER_HOUR);
  });
});
