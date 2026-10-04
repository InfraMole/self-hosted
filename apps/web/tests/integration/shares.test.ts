// SPDX-License-Identifier: AGPL-3.0-only
/** Public read-only map links (M31, ADR-045). */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { savedViewStateSchema } from "@/lib/map-view-state";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { listAuditEvents } from "@/server/modules/audit/audit";
import { runRetention } from "@/server/modules/maintenance/retention";
import {
  SHARES_LIMIT,
  ShareError,
  createShare,
  listShares,
  resolveShare,
  revokeShare,
} from "@/server/modules/map/shares";
import { deleteSavedView } from "@/server/modules/map/views";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

async function memberContext(owner: WorkspaceContext, role: Role) {
  const user = await createTestUser(`${role} user`);
  await adminDb().membership.create({
    data: { workspaceId: owner.workspaceId, userId: user.id, role },
  });
  return (await findWorkspaceContextForUser(user.id, owner.workspaceSlug))!;
}

/** SQL01 ← CustomersDB ← Billing, plus an unrelated NAS; a view "impact of SQL01". */
async function seed(ctx: WorkspaceContext) {
  const db = adminDb();
  const r = (name: string, extra: object = {}) =>
    db.resource.create({
      data: { workspaceId: ctx.workspaceId, name, type: "APPLICATION", ...extra },
    });
  const sql01 = await r("SQL01", {
    type: "SERVER",
    metadata: { ipAddresses: ["10.0.0.5"] },
    owner: "DBA",
    ownerContact: "dba@example.com",
  });
  const cdb = await r("CustomersDB", { type: "DATABASE" });
  const billing = await r("Billing", { owner: "Finance" });
  await r("NAS01", { type: "STORAGE" });
  const rel = (from: string, type: string, to: string, note: string | null = null) =>
    db.relationship.create({
      data: {
        workspaceId: ctx.workspaceId,
        fromResourceId: from,
        toResourceId: to,
        type: type as never,
        origin: "MANUAL",
        status: "CONFIRMED",
        note,
      },
    });
  await rel(cdb.id, "RUNS_ON", sql01.id, "instance at 10.0.0.5:1433");
  await rel(billing.id, "USES_DATABASE", cdb.id);
  const view = await db.savedView.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: "If SQL01 goes down",
      state: savedViewStateSchema.parse({ impact: sql01.id }),
    },
  });
  return { sql01, view };
}

describe("public map links", () => {
  it("only admins create, list and revoke them; the token is shown once and audited", async () => {
    const owner = await ownerContext("Acme");
    const { view } = await seed(owner);
    const member = await memberContext(owner, "MEMBER");
    await expect(createShare(member, { viewId: view.id, expiresInDays: 30 })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(listShares(member)).rejects.toThrow(ForbiddenError);

    const admin = await memberContext(owner, "ADMIN");
    const created = await createShare(admin, { viewId: view.id, expiresInDays: 30 });
    expect(created.token).toMatch(/^dmp_shr_[A-Za-z0-9_-]{43}$/);
    const row = await adminDb().mapShare.findUniqueOrThrow({ where: { id: created.id } });
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect((await listShares(owner)).map((s) => [s.viewName, s.state])).toEqual([
      ["If SQL01 goes down", "active"],
    ]);
    await revokeShare(owner, created.id);
    await expect(revokeShare(owner, created.id)).rejects.toThrow(ShareError);
    expect(await resolveShare(created.token)).toBeNull();
    const audit = await listAuditEvents(owner, { group: "workspace" });
    expect(audit.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["share.created", "share.revoked"]),
    );
  });

  it("shows only the view's subset, without IPs, owners, contacts or notes", async () => {
    const owner = await ownerContext("Acme");
    const { view, sql01 } = await seed(owner);
    const { token } = await createShare(owner, { viewId: view.id, expiresInDays: 0 });
    const shared = (await resolveShare(token))!;
    expect(shared.viewName).toBe("If SQL01 goes down");
    expect(shared.workspaceName).toBe("Acme");
    expect(shared.nodes.map((n) => n.name).sort()).toEqual(["Billing", "CustomersDB", "SQL01"]);
    const text = JSON.stringify(shared);
    for (const secret of ["10.0.0.5", "DBA", "dba@example.com", "Finance", "1433", "NAS01"])
      expect(text).not.toContain(secret);
    expect(shared.state.impact).toBe(sql01.id);
    expect(
      (await adminDb().mapShare.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } }))
        .lastViewedAt,
    ).not.toBeNull();
  });

  it("refuses malformed, unknown, expired links and links to a deleted view", async () => {
    const owner = await ownerContext("Acme");
    const { view } = await seed(owner);
    expect(await resolveShare("nope")).toBeNull();
    expect(await resolveShare(`dmp_shr_${"A".repeat(43)}`)).toBeNull();
    const { token, id } = await createShare(owner, { viewId: view.id, expiresInDays: 7 });
    await adminDb().mapShare.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await resolveShare(token)).toBeNull();
    const again = await createShare(owner, { viewId: view.id, expiresInDays: 7 });
    expect(await resolveShare(again.token)).not.toBeNull();
    await deleteSavedView(owner, view.id);
    expect(await resolveShare(again.token)).toBeNull();
    expect(await adminDb().mapShare.count()).toBe(0); // the links went with the view
  });

  it("never shares another workspace's view, and caps active links", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const { view } = await seed(acme);
    await expect(createShare(globex, { viewId: view.id, expiresInDays: 30 })).rejects.toThrow(
      ShareError,
    );
    await adminDb().mapShare.createMany({
      data: Array.from({ length: SHARES_LIMIT }, (_, i) => ({
        workspaceId: acme.workspaceId,
        savedViewId: view.id,
        tokenHash: `h${i}`,
        prefix: "dmp_shr_x",
        createdById: acme.userId,
      })),
    });
    await expect(createShare(acme, { viewId: view.id, expiresInDays: 30 })).rejects.toThrow(
      ShareError,
    );
  });

  it("retention deletes links revoked long ago", async () => {
    const owner = await ownerContext("Acme");
    const { view } = await seed(owner);
    await adminDb().mapShare.createMany({
      data: [new Date(Date.now() - 100 * 86_400_000), null].map((revokedAt, i) => ({
        workspaceId: owner.workspaceId,
        savedViewId: view.id,
        tokenHash: `r${i}`,
        prefix: "dmp_shr_x",
        createdById: owner.userId,
        revokedAt,
      })),
    });
    expect(await runRetention()).toMatchObject({ shares: 1 });
    expect(await adminDb().mapShare.count()).toBe(1);
  });
});
