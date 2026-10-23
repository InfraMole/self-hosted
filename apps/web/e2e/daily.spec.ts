// SPDX-License-Identifier: AGPL-3.0-only
/** Daily use (M29): quick search, find on map, owners and who to warn, version, theme. */
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

const w = `/w/${OWNER.slug}`;

test("Ctrl+K finds a resource and opens it", async ({ page }) => {
  await page.goto(`${w}/library`);
  await page.keyboard.press("Control+k");
  const box = page.getByLabel("Search resources and pages");
  await box.fill("sql0");
  await expect(page.getByRole("option").first()).toContainText("SQL01");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/resources\//);
  await expect(page.getByText("SQL01").first()).toBeVisible();
});

test("find on map selects a resource hidden by a filter", async ({ page }) => {
  await page.goto(`${w}/map`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByLabel("Type").selectOption("DOMAIN"); // orders-db is now hidden
  await page.getByLabel("Find a resource on the map").fill("orders");
  await page.getByRole("button", { name: /orders-db/ }).click();
  await expect(page.getByRole("complementary", { name: "orders-db details" })).toBeVisible();
  await expect(page.getByLabel("Type")).toHaveValue("");
});

test("owners set in bulk show up as who to warn", async ({ page }) => {
  await page.goto(`${w}/library`);
  for (const name of ["shop", "billing"])
    await page
      .locator("tbody tr")
      .filter({ has: page.getByRole("link", { name: new RegExp(`(^|\\s)${name}$`) }) })
      .getByRole("checkbox")
      .check();
  await page.getByRole("button", { name: "Set owner…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Platform team").fill("Web team");
  await dialog.getByPlaceholder("platform@example.com").fill("web@example.com");
  await dialog.getByRole("button", { name: "Set owner" }).click();
  await expect(page.getByText("Owner set on 2")).toBeVisible();

  await page.locator("tbody").getByRole("link", { name: /SQL01/ }).click();
  await page.getByRole("link", { name: "Impact" }).click();
  const warn = page.getByRole("region", { name: "Who to warn" });
  await expect(warn).toContainText("Web team");
  await expect(warn).toContainText("web@example.com");
  await expect(warn).toContainText("2 resources");
  for (const name of ["shop", "billing"]) await expect(warn).toContainText(name);
  await expect(warn).toContainText("No owner recorded for 2 of them");
});

test("settings show which InfraMole is running", async ({ page }) => {
  await page.goto(`${w}/settings`);
  await expect(page.getByText("InfraMole version")).toBeVisible();
  await expect(page.getByText("development build")).toBeVisible();
});

test("what's new lists server and agent releases, with a feed (M36)", async ({ page, request }) => {
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { name: "What's new", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "InfraMole 0.26.0" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent 0.6.1" })).toBeVisible();
  await expect(page.locator('[id="v0.26.0"]')).toContainText("caddy.d");
  const feed = await request.get("/changelog/feed.xml");
  expect(feed.headers()["content-type"]).toContain("application/atom+xml");
  expect(await feed.text()).toContain("<title>InfraMole 0.26.0</title>");
  await page.goto("/es/changelog");
  await expect(page.getByText("Las notas de cada versión se publican en inglés.")).toBeVisible();
});

test("an installation without analytics loads none and allows no third-party origin", async ({
  page,
  request,
}) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  const res = await page.goto("/docs/quickstart");
  const csp = res!.headers()["content-security-policy"]!;
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self';");
  expect((await request.get("/api/analytics")).status()).toBe(204);
  await page.waitForTimeout(1500);
  const origin = new URL(res!.url()).origin;
  expect(requested.filter((u) => !u.startsWith(origin) && !u.startsWith("data:"))).toEqual([]);
});

test("the theme is chosen per browser: dark, light or match system (ADR-054)", async ({ page }) => {
  const html = page.locator("html");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${w}/library`);
  await expect(html).toHaveClass(/\bdark\b/); // dark by default, whatever the system says

  await page.getByRole("button", { name: "Switch to the light theme" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.goto("/account");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await page.getByRole("radio", { name: "Match system" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole("radio", { name: "Dark" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveClass(/\bdark\b/);
});
