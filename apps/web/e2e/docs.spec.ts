// SPDX-License-Identifier: AGPL-3.0-only
/** Public docs layout: long commands scroll inside their block, never past the column. */
import { expect, test } from "@playwright/test";

for (const path of ["/docs/operations/upgrade", "/es/docs/agent/install"]) {
  test(`code blocks in tabs stay inside the column on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(".doc-tabs").first()).toBeVisible();
    const overflowing = await page.evaluate(() => {
      const column = document.querySelector(".doc-prose")!.getBoundingClientRect();
      return [...document.querySelectorAll(".doc-prose pre, .doc-tabs, .doc-tab-panel")]
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.right > column.right + 1).length;
    });
    expect(overflowing).toBe(0);
  });
}
