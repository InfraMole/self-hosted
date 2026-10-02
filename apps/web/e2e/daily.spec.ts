// SPDX-License-Identifier: AGPL-3.0-only
/** Daily use (M29): quick search, find on map, owners and who to warn, version. */
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
