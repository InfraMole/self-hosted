// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

const library = `/w/${OWNER.slug}/library`;

test("the Library lists, filters and adds resources", async ({ page }) => {
  await page.goto(library);
  const rows = page.locator("tbody tr");
  // Other specs add resources too (agent, integrations): check the imported ones.
  for (const name of [
    "WEB01",
    "SQL01",
    "shop",
    "billing",
    "orders-db",
    "shop.example.com",
    "NAS01",
  ])
    await expect(rows.filter({ hasText: name }).first()).toBeVisible();
  const total = await rows.count();

  await page.getByLabel("Search resources").fill("sql");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("SQL01");
  await page.getByLabel("Search resources").fill("");
  await expect(rows).toHaveCount(total);

  await page.getByRole("button", { name: "Add resource" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator("#name").fill("CACHE01");
  await sheet.locator("#type").selectOption("SERVER");
  await sheet.getByRole("button", { name: "Create resource" }).click();
  await expect(sheet).toBeHidden();
  // Creating opens the new resource.
  await expect(page).toHaveURL(/\/resources\//);
  await expect(page.getByText("CACHE01").first()).toBeVisible();
  await expect(page.getByText("Manual", { exact: true })).toBeVisible();
});

test("a resource page shows its relationships", async ({ page }) => {
  await page.goto(library);
  await page
    .getByRole("link", { name: /^.*orders-db/ })
    .first()
    .click();
  await expect(page.getByText("orders-db").first()).toBeVisible();
  await page.getByRole("link", { name: "Dependencies" }).click();
  for (const name of ["shop", "billing", "SQL01", "NAS01"])
    await expect(page.getByRole("main").getByText(name, { exact: true }).first()).toBeVisible();
});

test("sorts by column and warns before creating a duplicate name", async ({ page }) => {
  await page.goto(library);
  await page.getByRole("link", { name: "Criticality", exact: true }).click();
  await expect(page).toHaveURL(/sort=criticality&dir=desc/);
  await expect(page.locator("tbody tr").first()).toContainText("SQL01");
  await page.getByRole("link", { name: "Criticality", exact: true }).click();
  await expect(page).toHaveURL(/sort=criticality&dir=asc/);

  await page.getByRole("button", { name: "Add resource" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator("#name").fill("BILLING");
  await sheet.locator("#type").selectOption("APPLICATION");
  await sheet.getByRole("button", { name: "Create resource" }).click();
  await expect(sheet.getByText("A resource with this name already exists:")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "billing" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Create anyway" })).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
});
