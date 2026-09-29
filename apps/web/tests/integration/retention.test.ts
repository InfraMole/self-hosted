// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as maintenanceRoute } from "@/app/api/cron/maintenance/route";
import { runRetention } from "@/server/modules/maintenance/retention";
import { createWorkspace } from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe("retention policy", () => {
  it("deletes exactly what is past its retention and keeps the rest", async () => {
    const user = await createTestUser("Owner");
    const ws = await createWorkspace(user.id, { name: "Acme" });
    const db = adminDb();
    const agent = (status: "ACTIVE" | "REVOKED", revokedAt: Date | null, machineId: string) =>
      db.agent.create({
        data: {
          workspaceId: ws.id,
          machineId,
          hostname: machineId,
          os: "linux",
          osVersion: "12",
          arch: "amd64",
          agentVersion: "0.2.0",
          secretHash: machineId.padEnd(64, "0"),
          secretPrefix: "dmp_agt_x",
          status,
          revokedAt,
        },
      });
    const active = await agent("ACTIVE", null, "active-01");
    await agent("REVOKED", daysAgo(100), "old-revoked");
    await agent("REVOKED", daysAgo(10), "new-revoked");
    for (const [receivedAt, n] of [
      [daysAgo(8), 1],
      [daysAgo(1), 2],
    ] as const)
      await db.observation.create({
        data: {
          workspaceId: ws.id,
          agentId: active.id,
          receivedAt,
          schemaVersion: 1,
          payload: { n },
          payloadBytes: 10,
        },
      });
    await db.changeEvent.createMany({
      data: [400, 10].map((d) => ({
        workspaceId: ws.id,
        occurredAt: daysAgo(d),
        actorType: "SYSTEM" as const,
        subjectType: "RESOURCE" as const,
        subjectId: "x",
        subjectLabel: "x",
        kind: "UPDATED" as const,
        summary: `${d}`,
      })),
    });
    await db.invitation.createMany({
      data: [
        { email: "old@example.test", acceptedAt: daysAgo(40), expiresAt: daysAgo(35) },
        { email: "pending@example.test", expiresAt: daysAgo(-5) },
      ].map((i, k) => ({
        ...i,
        workspaceId: ws.id,
        role: "MEMBER" as const,
        tokenHash: `h${k}`,
        invitedById: user.id,
      })),
    });
    await db.enrollmentToken.createMany({
      data: [daysAgo(100), daysAgo(-1)].map((expiresAt, k) => ({
        workspaceId: ws.id,
        name: `t${k}`,
        tokenHash: `t${k}`,
        prefix: "dmp_enr_x",
        expiresAt,
        createdById: user.id,
      })),
    });
    await db.session.create({
      data: {
        id: "s-old",
        token: "s-old",
        userId: user.id,
        expiresAt: daysAgo(1),
        updatedAt: new Date(),
      },
    });
    await db.session.create({
      data: {
        id: "s-live",
        token: "s-live",
        userId: user.id,
        expiresAt: daysAgo(-1),
        updatedAt: new Date(),
      },
    });

    expect(await runRetention()).toMatchObject({
      observations: 1,
      changeEvents: 1,
      invitations: 1,
      enrollmentTokens: 1,
      agents: 1,
      sessions: 1,
    });
    expect((await db.agent.findMany()).map((a) => a.hostname).sort()).toEqual([
      "active-01",
      "new-revoked",
    ]);
    expect((await db.invitation.findMany()).map((i) => i.email)).toEqual(["pending@example.test"]);
    expect(await db.observation.count()).toBe(1);
    expect(await runRetention()).toMatchObject({ observations: 0, agents: 0 }); // idempotent
  });

  it("the maintenance endpoint requires the cron secret", async () => {
    const call = (auth?: string) =>
      maintenanceRoute(
        new Request("http://localhost/api/cron/maintenance", {
          method: "POST",
          headers: auth ? { authorization: auth } : {},
        }),
      );
    expect((await call()).status).toBe(401);
    const ok = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toHaveProperty("auditEvents");
  });
});
