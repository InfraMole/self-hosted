// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resilience report (M44): what could affect the most, single points of
 * failure and recovery order for the imported infrastructure, plus the
 * Library's "Could affect" column.
 */
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

test("shows single points of failure and the recovery order", async ({ page }) => {
  await page.goto(`/w/${OWNER.slug}/library`);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Resilience" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${OWNER.slug}/resilience$`));

  const report = page.getByRole("article", { name: "Resilience report" });
  await expect(report.getByRole("heading", { name: "Whole map" })).toBeVisible();

  const single = report.getByRole("region", { name: "Single points of failure" });
  await expect(single.getByRole("listitem").first()).toContainText(
    /SQL01\s*Server\s*could affect\s*4/,
  );
  for (const name of ["SQL01", "WEB01", "orders-db", "shop"])
    await expect(single.getByRole("link", { name, exact: true })).toBeVisible();

  const most = report.getByRole("table", { name: "Most impact" });
  await expect(most.locator("tbody tr").first()).toContainText("SQL01");

  const recovery = report.getByRole("region", { name: "Recovery order" });
  const first = recovery.getByRole("listitem").filter({ hasText: "Wave 1" });
  await expect(first).toContainText("SQL01");
  await expect(first).toContainText("WEB01");
  // Backups are informational: the NAS can come back in any order.
  await expect(recovery).toContainText(/any order:.*NAS01/);
  await expect(report).not.toContainText(/will break/i);

  await page.getByLabel("Relationships counted").selectOption("all");
  await expect(page).toHaveURL(/confidence=all/);
  await expect(report).toContainText("counting confirmed, detected and inferred relationships");
});

test("sorts the Library by what each resource could affect", async ({ page }) => {
  await page.goto(`/w/${OWNER.slug}/library`);
  await page.getByRole("link", { name: "Could affect" }).click();
  await expect(page).toHaveURL(/sort=impact&dir=desc/);
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toContainText("SQL01");
  await expect(firstRow.getByRole("link", { name: "4", exact: true })).toBeVisible();
});
