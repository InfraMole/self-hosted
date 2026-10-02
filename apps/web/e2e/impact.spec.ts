// SPDX-License-Identifier: AGPL-3.0-only
/** "If this fails, what could be affected?" — the moment the product convinces. */
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

test("the impact page of a server lists what could be affected", async ({ page }) => {
  await page.goto(`/w/${OWNER.slug}/library`);
  await page.locator("tbody").getByRole("link", { name: /SQL01/ }).click();
  await page.getByRole("link", { name: "Impact" }).click();
  await expect(
    page.getByText(/If\s+SQL01\s+fails,\s+4\s+resources could be affected/),
  ).toBeVisible();
  for (const name of ["orders-db", "shop", "billing", "shop.example.com"])
    await expect(page.getByRole("main").getByText(name, { exact: true }).first()).toBeVisible();
  // Never worded as certain.
  await expect(page.getByRole("main")).not.toContainText(/will break/i);
});
