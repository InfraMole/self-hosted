// SPDX-License-Identifier: AGPL-3.0-only
/** Ready for teams (M30): the path between two resources and the read-only API. */
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

const w = `/w/${OWNER.slug}`;

test("path to… shows how two resources are linked, as a chain and as text", async ({ page }) => {
  await page.goto(`${w}/map`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByLabel("Find a resource on the map").fill("shop.ex");
  await page.getByRole("button", { name: /shop\.example\.com/ }).click();
  const inspector = page.getByRole("complementary", { name: "shop.example.com details" });
  await inspector.getByRole("button", { name: "Path to…" }).click();
  await inspector.getByLabel("Path from shop.example.com to").fill("SQL0");
  await inspector.getByRole("button", { name: /SQL01/ }).click();

  const banner = page.getByRole("status").filter({ hasText: "depends on" });
  await expect(banner).toContainText("shop.example.com depends on SQL01");
  await expect(banner).toContainText("3 hops");
  // Only the chain is drawn: domain → shop → orders-db → SQL01.
  await expect(page.getByText("4 resources · 3 relationships")).toBeVisible();

  await banner.getByRole("button", { name: "Exit path view" }).click();
  await expect(page.getByLabel("Type")).toBeVisible();
});

test("an admin creates a read-only API token, uses it and revokes it", async ({
  page,
  request,
}) => {
  await page.goto(`${w}/settings`);
  await page.getByRole("button", { name: "New API token" }).click();
  await page.getByLabel("Name").fill("E2E script");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = (await page.locator("pre").first().textContent())!.trim();
  expect(token).toMatch(/^dmp_api_[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "Done" }).click();

  const auth = { Authorization: `Bearer ${token}` };
  const list = await request.get("/api/v1/resources?q=sql01", { headers: auth });
  expect(list.status()).toBe(200);
  const sql01 = ((await list.json()) as { data: { id: string; name: string }[] }).data[0]!;
  expect(sql01.name).toBe("SQL01");

  const impact = await request.get(`/api/v1/resources/${sql01.id}/impact`, { headers: auth });
  const names = (
    (await impact.json()) as { data: { affected: { resource: { name: string } }[] } }
  ).data.affected.map((a) => a.resource.name);
  expect(names).toEqual(expect.arrayContaining(["orders-db", "shop", "billing"]));

  // Read-only: there is nothing to write to.
  expect((await request.post("/api/v1/resources", { headers: auth, data: {} })).status()).toBe(405);

  await page.reload();
  await page.getByRole("button", { name: "Revoke API token E2E script" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator("#api").getByText("revoked")).toBeVisible();
  expect((await request.get("/api/v1/workspace", { headers: auth })).status()).toBe(401);
});
