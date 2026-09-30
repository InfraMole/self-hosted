// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cronRoute } from "@/app/api/cron/integrations/route";
import { ForbiddenError, type WorkspaceContext } from "@/server/authz";
import { listWorkspaceChanges } from "@/server/modules/changes/changes";
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  syncDueIntegrations,
  syncIntegration,
  testIntegration,
} from "@/server/modules/integrations/integrations";
import type { ProviderDeps } from "@/server/modules/integrations/providers";
import { listResources } from "@/server/modules/resources/resources";
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

const TOKEN = "cf_secret_token_1234567890abcd";
const cloudflareInput = {
  kind: "CLOUDFLARE" as const,
  name: "Cloudflare prod",
  config: { zones: "" },
  secret: { apiToken: TOKEN },
};

/** Fake Cloudflare API: one zone, one proxied record. */
const fakeCloudflare = (
  records = [{ name: "app.example.com", type: "A", content: "203.0.113.10", proxied: true }],
): ProviderDeps => ({
  http: async (url, init) => {
    if (init?.headers?.authorization !== `Bearer ${TOKEN}`) {
      return {
        status: 403,
        headers: new Headers(),
        text: JSON.stringify({ success: false, errors: [{ message: "bad token" }] }),
      };
    }
    const body = url.includes("/dns_records")
      ? { success: true, result: records, result_info: { total_pages: 1 } }
      : {
          success: true,
          result: [{ id: "z1", name: "example.com" }],
          result_info: { total_pages: 1 },
        };
    return { status: 200, headers: new Headers(), text: JSON.stringify(body) };
  },
});

describe("integrations with stored credentials", () => {
  it("stores the secret sealed, never exposes it, and syncs through the importer", async () => {
    const ctx = await ownerContext("Acme");
    const created = await createIntegration(ctx, cloudflareInput);
    expect(created).toMatchObject({
      kind: "CLOUDFLARE",
      name: "Cloudflare prod",
      secretHint: "abcd",
    });
    expect(JSON.stringify(created)).not.toContain(TOKEN);

    const row = await adminDb().integration.findUniqueOrThrow({ where: { id: created.id } });
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(row.secretKeyVersion).toBe(1);
    expect(JSON.stringify(await listIntegrations(ctx))).not.toContain(row.secretCiphertext);

    const outcome = await syncIntegration(ctx, created.id, fakeCloudflare());
    expect(outcome).toMatchObject({ ok: true });
    expect((await listResources(ctx, { type: "DOMAIN" })).map((r) => r.name)).toEqual([
      "app.example.com",
    ]);
    const feed = await listWorkspaceChanges(ctx, { actor: "import" });
    expect(feed.events[0]!.actorName).toBe("integration:Cloudflare prod");
    const [after] = await listIntegrations(ctx);
    expect(after).toMatchObject({ lastSyncOk: true });
    expect(after!.lastSyncAt).toBeInstanceOf(Date);
  });

  it("records provider failures on the integration without throwing", async () => {
    const ctx = await ownerContext("Acme");
    const created = await createIntegration(ctx, {
      ...cloudflareInput,
      secret: { apiToken: "wrong_token_1234567890xx" },
    });
    const outcome = await syncIntegration(ctx, created.id, fakeCloudflare());
    expect(outcome).toEqual({ ok: false, message: "Cloudflare API: bad token" });
    expect((await listIntegrations(ctx))[0]).toMatchObject({
      lastSyncOk: false,
      lastSyncMessage: "Cloudflare API: bad token",
    });
  });

  it("a sealed secret copied to another workspace cannot be decrypted (AAD)", async () => {
    const acme = await ownerContext("Acme");
    const globex = await ownerContext("Globex");
    const a = await createIntegration(acme, cloudflareInput);
    const g = await createIntegration(globex, {
      ...cloudflareInput,
      secret: { apiToken: "globex_token_1234567890xx" },
    });
    const stolen = await adminDb().integration.findUniqueOrThrow({ where: { id: a.id } });
    await adminDb().integration.update({
      where: { id: g.id },
      data: { secretCiphertext: stolen.secretCiphertext, secretIv: stolen.secretIv },
    });
    const outcome = await syncIntegration(globex, g.id, fakeCloudflare());
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/could not be decrypted/);
    // And the other workspace cannot even see or sync Acme's integration.
    await expect(syncIntegration(globex, a.id, fakeCloudflare())).rejects.toThrow(/not found/i);
    await expect(deleteIntegration(globex, a.id)).rejects.toThrow(/not found/i);
  });

  it("test connection previews without storing anything", async () => {
    const ctx = await ownerContext("Acme");
    const plan = await testIntegration(ctx, cloudflareInput, fakeCloudflare());
    expect(plan.format).toBe("cloudflare");
    expect(plan.counts.create).toBe(2); // domain + Cloudflare service
    expect(await adminDb().integration.count()).toBe(0);
    expect(await adminDb().resource.count()).toBe(0);
  });

  it("only ADMIN+ can manage integrations", async () => {
    const ctx = await ownerContext("Acme");
    const member = await createTestUser("Member");
    await adminDb().membership.create({
      data: { workspaceId: ctx.workspaceId, userId: member.id, role: "MEMBER" },
    });
    const mctx = (await findWorkspaceContextForUser(member.id, ctx.workspaceSlug))!;
    await expect(createIntegration(mctx, cloudflareInput)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listIntegrations(mctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scheduled sync respects each integration's interval; the cron endpoint requires the secret", async () => {
    const ctx = await ownerContext("Acme");
    const created = await createIntegration(ctx, { ...cloudflareInput, syncIntervalHours: 6 });
    const deps = fakeCloudflare();
    expect(await syncDueIntegrations(new Date(), deps)).toEqual({ due: 1, ok: 1, failed: 0 });
    expect(await syncDueIntegrations(new Date(), deps)).toEqual({ due: 0, ok: 0, failed: 0 });
    const later = new Date(Date.now() + 7 * 3_600_000);
    expect(await syncDueIntegrations(later, deps)).toMatchObject({ due: 1 });

    const call = (auth?: string) =>
      cronRoute(
        new Request("http://localhost/api/cron/integrations", {
          method: "POST",
          headers: auth ? { authorization: auth } : {},
        }),
      );
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    // Real providers are used by the route; with no due integrations it just reports zero.
    await adminDb().integration.update({
      where: { id: created.id },
      data: { lastSyncAt: new Date() },
    });
    const ok = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ due: 0, ok: 0, failed: 0 });
  });
});

describe("cloud integrations (M23)", () => {
  const HZ_TOKEN = "hetzner_read_token_0123456789abcdef0123456789";
  /** Fake Hetzner Cloud API; `servers` changes between syncs. */
  const fakeHetzner = (servers: { id: number; name: string; ip: string }[]): ProviderDeps => ({
    http: async (url, init) => {
      if (init?.headers?.authorization !== `Bearer ${HZ_TOKEN}`)
        return { status: 401, headers: new Headers(), text: "{}" };
      const body = url.includes("/load_balancers")
        ? {
            load_balancers: [
              {
                id: 9,
                name: "lb-web",
                public_net: { ipv4: { ip: "203.0.113.99" } },
                services: [{ listen_port: 443 }],
                targets: servers.map((s) => ({ type: "server", server: { id: s.id } })),
              },
            ],
            meta: { pagination: { next_page: null } },
          }
        : {
            servers: servers.map((s) => ({
              id: s.id,
              name: s.name,
              status: "running",
              public_net: { ipv4: { ip: s.ip } },
            })),
            meta: { pagination: { next_page: null } },
          };
      return { status: 200, headers: new Headers(), text: JSON.stringify(body) };
    },
  });

  it("imports servers and load balancer backends, and reconciles removed servers", async () => {
    const ctx = await ownerContext("Acme");
    const created = await createIntegration(ctx, {
      kind: "HETZNER",
      name: "Hetzner",
      secret: { apiToken: HZ_TOKEN },
    });
    const first = await syncIntegration(
      ctx,
      created.id,
      fakeHetzner([
        { id: 1, name: "web-1", ip: "203.0.113.1" },
        { id: 2, name: "web-2", ip: "203.0.113.2" },
      ]),
    );
    expect(first).toMatchObject({ ok: true });
    const resources = await listResources(ctx, {});
    expect(resources.map((r) => [r.name, r.type, r.status]).sort()).toEqual([
      ["lb-web", "NETWORK", "DISCOVERED"],
      ["web-1", "VM", "DISCOVERED"],
      ["web-2", "VM", "DISCOVERED"],
    ]);
    const rels = await adminDb().relationship.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { from: true, to: true },
    });
    expect(rels.map((r) => [r.from.name, r.type, r.to.name, r.status]).sort()).toEqual([
      ["web-1", "EXPOSED_THROUGH", "lb-web", "CONFIRMED"],
      ["web-2", "EXPOSED_THROUGH", "lb-web", "CONFIRMED"],
    ]);

    // web-2 deleted in Hetzner: the next sync marks it stale (reconcile), nothing is deleted.
    await syncIntegration(
      ctx,
      created.id,
      fakeHetzner([{ id: 1, name: "web-1", ip: "203.0.113.1" }]),
    );
    const after = await listResources(ctx, {});
    expect(after.find((r) => r.name === "web-2")!.status).toBe("STALE");
    expect(after.find((r) => r.name === "web-1")!.status).toBe("DISCOVERED");
  });
});
