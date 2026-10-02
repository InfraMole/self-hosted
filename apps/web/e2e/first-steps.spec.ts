// SPDX-License-Identifier: AGPL-3.0-only
/** First steps (M28): the checklist leads to the first "what could be affected?". */
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

test("the checklist ends on the impact of the most depended-on resource", async ({ page }) => {
  const library = `/w/${OWNER.slug}/library`;
  await page.goto(library);
  const card = page.getByRole("region", { name: "First steps" });
  // Imported resources and confirmed relationships: two of four already done.
  await expect(card).toContainText("first steps · 2 of 4");

  await card.getByRole("link", { name: "Open the map" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.goto(library);
  await expect(card).toContainText("3 of 4");
  await expect(card).toContainText("If SQL01 fails, 4 resources could be affected.");

  await card.getByRole("link", { name: "See what depends on SQL01" }).click();
  await expect(page.getByText(/If\s+SQL01\s+fails,\s+4\s+could be affected/)).toBeVisible();
  await page.goto(library);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(card).toHaveCount(0); // all done: it goes away
});
