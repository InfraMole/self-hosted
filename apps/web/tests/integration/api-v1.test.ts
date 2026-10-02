// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only API (M30, ADR-044): tokens, tenant isolation, endpoints. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as pathRoute } from "@/app/api/v1/path/route";
import { GET as relationshipsRoute } from "@/app/api/v1/relationships/route";
import { GET as impactRoute } from "@/app/api/v1/resources/[id]/impact/route";
import { GET as resourceRoute } from "@/app/api/v1/resources/[id]/route";
import { GET as resourcesRoute } from "@/app/api/v1/resources/route";
import { GET as workspaceRoute } from "@/app/api/v1/workspace/route";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { listAuditEvents } from "@/server/modules/audit/audit";
import {
  ApiTokenError,
  API_TOKENS_LIMIT,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/server/modules/api/tokens";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { resetRateLimits } from "@/server/rate-limit";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
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

const get = (path: string, token?: string) =>
  new Request(`http://localhost${path}`, {
    headers: {
      "x-forwarded-for": "203.0.113.7",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const body = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** PRODUCT.md example: portal → billing → db → SQL01, plus an archived and an ignored edge. */
async function seed(ctx: WorkspaceContext) {
  const db = adminDb();
  const r = async (name: string, extra: object = {}) =>
    (
      await db.resource.create({
        data: { workspaceId: ctx.workspaceId, name, type: "APPLICATION", ...extra },
      })
    ).id;
  const sql01 = await r("SQL01", {
    type: "SERVER",
    metadata: { hostname: "sql01", ipAddresses: ["10.0.0.5"] },
    owner: "DBA",
  });
  const cdb = await r("CustomersDB", { type: "DATABASE", owner: "DBA", ownerContact: "dba@x" });
  const billing = await r("Billing", { owner: "Finance apps" });
  const portal = await r("IT Portal");
  const old = await r("Old app", { status: "ARCHIVED" });
  const rel = (from: string, type: string, to: string, extra: object = {}) =>
    db.relationship.create({
      data: {
        workspaceId: ctx.workspaceId,
        fromResourceId: from,
        toResourceId: to,
        type: type as never,
        origin: "MANUAL",
        status: "CONFIRMED",
        ...extra,
      },
    });
  await rel(cdb, "RUNS_ON", sql01);
  await rel(billing, "USES_DATABASE", cdb);
  await rel(portal, "CALLS", billing, { origin: "DETECTED", status: "UNCONFIRMED" });
  await rel(old, "DEPENDS_ON", sql01);
  await rel(portal, "DEPENDS_ON", sql01, { status: "IGNORED" });
  return { sql01, cdb, billing, portal, old };
}

describe("API tokens", () => {
  it("only admins manage tokens; the plaintext is returned once, stored hashed and audited", async () => {
    const owner = await ownerContext("Acme");
    for (const role of ["VIEWER", "MEMBER"] as const) {
      const ctx = await memberContext(owner, role);
      await expect(createApiToken(ctx, { name: "x", expiresInDays: 30 })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(listApiTokens(ctx)).rejects.toThrow(ForbiddenError);
    }
    const admin = await memberContext(owner, "ADMIN");
    const created = await createApiToken(admin, { name: "Reporting", expiresInDays: 90 });
    expect(created.token).toMatch(/^dmp_api_[A-Za-z0-9_-]{43}$/);
    const row = await adminDb().apiToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(row.prefix).toBe(created.token.slice(0, 12));
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);

    const never = await createApiToken(owner, { name: "CI", expiresInDays: 0 });
    expect(never.expiresAt).toBeNull();
    await expect(createApiToken(owner, { name: "x", expiresInDays: 7 })).rejects.toThrow();

    const list = await listApiTokens(owner);
    expect(list.map((t) => [t.name, t.state])).toEqual([
      ["CI", "active"],
      ["Reporting", "active"],
    ]);
    await revokeApiToken(owner, created.id);
    await expect(revokeApiToken(owner, created.id)).rejects.toThrow(ApiTokenError);
    expect((await listApiTokens(owner)).find((t) => t.id === created.id)?.state).toBe("revoked");

    const audit = await listAuditEvents(owner, { group: "workspace" });
    expect(audit.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["api.token_created", "api.token_revoked"]),
    );
  });

  it(`caps active tokens at ${API_TOKENS_LIMIT}`, async () => {
    const owner = await ownerContext("Acme");
    await adminDb().apiToken.createMany({
      data: Array.from({ length: API_TOKENS_LIMIT }, (_, i) => ({
        workspaceId: owner.workspaceId,
        name: `t${i}`,
        tokenHash: `hash-${i}`,
        prefix: "dmp_api_xxxx",
        createdById: owner.userId,
      })),
    });
    await expect(createApiToken(owner, { name: "one more", expiresInDays: 30 })).rejects.toThrow(
      ApiTokenError,
    );
  });

  it("refuses missing, malformed, unknown, revoked and expired tokens", async () => {
    const owner = await ownerContext("Acme");
    const { token, id } = await createApiToken(owner, { name: "t", expiresInDays: 30 });
    expect((await workspaceRoute(get("/api/v1/workspace"))).status).toBe(401);
    expect((await workspaceRoute(get("/api/v1/workspace", "nope"))).status).toBe(401);
    expect(
      (await workspaceRoute(get("/api/v1/workspace", `dmp_api_${"A".repeat(43)}`))).status,
    ).toBe(401);
    // An agent secret is not an API token.
    expect(
      (await workspaceRoute(get("/api/v1/workspace", `dmp_agt_${"A".repeat(43)}`))).status,
    ).toBe(401);

    const ok = await workspaceRoute(get("/api/v1/workspace", token));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await body(ok)).data).toMatchObject({ name: "Acme", slug: owner.workspaceSlug });
    expect(
      (await adminDb().apiToken.findUniqueOrThrow({ where: { id } })).lastUsedAt,
    ).not.toBeNull();

    await adminDb().apiToken.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await workspaceRoute(get("/api/v1/workspace", token))).status).toBe(401);
    await adminDb().apiToken.update({
      where: { id },
      data: { expiresAt: null, revokedAt: new Date() },
    });
    expect((await workspaceRoute(get("/api/v1/workspace", token))).status).toBe(401);
  });

  it("rate limits per token", async () => {
    const owner = await ownerContext("Acme");
    const { token } = await createApiToken(owner, { name: "t", expiresInDays: 30 });
    let last = 200;
    for (let i = 0; i < 301; i++)
      last = (await workspaceRoute(get("/api/v1/workspace", token))).status;
    expect(last).toBe(429);
  });
});

describe("API v1 endpoints", () => {
  it("only ever reads the token's workspace", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const a = await seed(acme);
    await seed(globex);
    const { token } = await createApiToken(globex, { name: "t", expiresInDays: 30 });

    const list = await body(await resourcesRoute(get("/api/v1/resources", token)));
    expect(list.data).toHaveLength(4);
    expect(new Set(list.data.map((r: { id: string }) => r.id)).has(a.sql01)).toBe(false);
    // Another workspace's ids are simply not found.
    expect(
      (await resourceRoute(get(`/api/v1/resources/${a.sql01}`, token), params({ id: a.sql01 })))
        .status,
    ).toBe(404);
    expect(
      (
        await impactRoute(
          get(`/api/v1/resources/${a.sql01}/impact`, token),
          params({ id: a.sql01 }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await pathRoute(get(`/api/v1/path?from=${a.portal}&to=${a.sql01}`, token))).status,
    ).toBe(404);
    const rels = await body(
      await relationshipsRoute(get(`/api/v1/relationships?resource=${a.sql01}`, token)),
    );
    expect(rels.data).toEqual([]);
  });

  it("lists resources with filters and keyset pagination", async () => {
    const owner = await ownerContext("Acme");
    const s = await seed(owner);
    const { token } = await createApiToken(owner, { name: "t", expiresInDays: 30 });

    const first = await body(await resourcesRoute(get("/api/v1/resources?limit=3", token)));
    expect(first.data).toHaveLength(3);
    expect(first.next).toBe(first.data[2].id);
    const second = await body(
      await resourcesRoute(get(`/api/v1/resources?limit=3&cursor=${first.next}`, token)),
    );
    expect(second.data).toHaveLength(1);
    expect(second.next).toBeNull();
    expect([...first.data, ...second.data].map((r: { name: string }) => r.name).sort()).toEqual([
      "Billing",
      "CustomersDB",
      "IT Portal",
      "SQL01",
    ]);

    const sql = await body(await resourcesRoute(get("/api/v1/resources?type=SERVER", token)));
    expect(sql.data).toEqual([
      expect.objectContaining({
        id: s.sql01,
        name: "SQL01",
        hostname: "sql01",
        ipAddresses: ["10.0.0.5"],
        owner: "DBA",
      }),
    ]);
    const archived = await body(
      await resourcesRoute(get("/api/v1/resources?status=ARCHIVED", token)),
    );
    expect(archived.data.map((r: { name: string }) => r.name)).toEqual(["Old app"]);
    const owned = await body(await resourcesRoute(get("/api/v1/resources?owner=dba", token)));
    expect(owned.data).toHaveLength(2);

    const bad = await resourcesRoute(get("/api/v1/resources?type=TOASTER&limit=9999", token));
    expect(bad.status).toBe(400);
    expect((await body(bad)).issues.map((i: { field: string }) => i.field).sort()).toEqual([
      "limit",
      "type",
    ]);
  });

  it("returns a resource with its relationships, never the ignored ones", async () => {
    const owner = await ownerContext("Acme");
    const s = await seed(owner);
    const { token } = await createApiToken(owner, { name: "t", expiresInDays: 30 });
    const res = await body(
      await resourceRoute(get(`/api/v1/resources/${s.portal}`, token), params({ id: s.portal })),
    );
    expect(res.data.name).toBe("IT Portal");
    expect(res.data.relationships).toEqual([
      expect.objectContaining({
        type: "CALLS",
        label: "calls",
        from: { id: s.portal, name: "IT Portal", type: "APPLICATION" },
        to: { id: s.billing, name: "Billing", type: "APPLICATION" },
        confidence: "detected",
        dependency: { dependent: s.portal, dependency: s.billing },
      }),
    ]);
    const all = await body(await relationshipsRoute(get("/api/v1/relationships", token)));
    expect(all.data).toHaveLength(4);
    const ignored = await body(
      await relationshipsRoute(get("/api/v1/relationships?status=IGNORED", token)),
    );
    expect(ignored.data).toHaveLength(1);
  });

  it("explains impact with confidence, paths and who to warn", async () => {
    const owner = await ownerContext("Acme");
    const s = await seed(owner);
    const { token } = await createApiToken(owner, { name: "t", expiresInDays: 30 });
    const res = await body(
      await impactRoute(get(`/api/v1/resources/${s.sql01}/impact`, token), params({ id: s.sql01 })),
    );
    expect(res.data.resource.name).toBe("SQL01");
    expect(
      res.data.affected.map((a: { resource: { name: string }; confidence: string }) => [
        a.resource.name,
        a.confidence,
      ]),
    ).toEqual([
      ["CustomersDB", "confirmed"],
      ["Billing", "confirmed"],
      ["IT Portal", "detected"],
    ]);
    expect(res.data.affected[2].path.map((p: { name: string }) => p.name)).toEqual([
      "SQL01",
      "CustomersDB",
      "Billing",
      "IT Portal",
    ]);
    expect(res.data.whoToWarn).toEqual({
      owners: [
        { owner: "DBA", contact: "dba@x", resources: ["CustomersDB"] },
        { owner: "Finance apps", contact: null, resources: ["Billing"] },
      ],
      withoutOwner: ["IT Portal"],
    });
    const shallow = await body(
      await impactRoute(
        get(`/api/v1/resources/${s.sql01}/impact?depth=1`, token),
        params({ id: s.sql01 }),
      ),
    );
    expect(shallow.data.affected).toHaveLength(1);
  });

  it("finds the path between two resources", async () => {
    const owner = await ownerContext("Acme");
    const s = await seed(owner);
    const { token } = await createApiToken(owner, { name: "t", expiresInDays: 30 });
    const res = await body(
      await pathRoute(get(`/api/v1/path?from=${s.portal}&to=${s.sql01}`, token)),
    );
    expect(res.data).toMatchObject({
      kind: "dependsOn",
      confidence: "detected",
      path: [
        { name: "IT Portal" },
        { name: "Billing" },
        { name: "CustomersDB" },
        { name: "SQL01" },
      ],
    });
    expect(res.data.text).toBe(
      [
        "IT Portal may depend on SQL01 (detected, not confirmed):",
        "- IT Portal calls Billing (detected, not confirmed)",
        "- Billing uses database CustomersDB",
        "- CustomersDB runs on SQL01",
      ].join("\n"),
    );
    // The ignored shortcut portal → SQL01 is never used; archived resources are not found.
    expect((await pathRoute(get(`/api/v1/path?from=${s.old}&to=${s.sql01}`, token))).status).toBe(
      404,
    );
    expect((await pathRoute(get(`/api/v1/path?from=${s.portal}`, token))).status).toBe(400);
  });
});
