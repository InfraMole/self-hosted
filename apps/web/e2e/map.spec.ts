// SPDX-License-Identifier: AGPL-3.0-only
/** The map is the core of the product (M26): layout, boxes, saved views, pins, impact. */
import { expect, test, type Page } from "@playwright/test";
import { OWNER } from "./env";

const map = `/w/${OWNER.slug}/map`;
/** The first view animates into place: wait until nodes stop moving. */
async function settle(page: Page) {
  const where = () =>
    page.locator(".react-flow__viewport").evaluate((el) => (el as HTMLElement).style.transform);
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await where();
        const stable = now === last;
        last = now;
        return stable;
      },
      { intervals: [300] },
    )
    .toBe(true);
}

const node = (page: Page, name: string) =>
  page
    .locator(".react-flow__node")
    .filter({ hasText: new RegExp(`^\\s*${name}`) })
    .first();

test("draws servers as boxes with what runs on them, and collapses them", async ({ page }) => {
  await page.goto(map);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  // Small map: boxes open by default.
  const boxes = page.locator(".react-flow__node-box");
  await expect(boxes).toHaveCount(2); // WEB01 (shop, billing) and SQL01 (orders-db)
  await settle(page);
  // What runs on WEB01 is drawn inside its box.
  const web = (await boxes.filter({ hasText: "WEB01" }).boundingBox())!;
  for (const name of ["shop", "billing"]) {
    const child = (await node(page, name).boundingBox())!;
    expect(child.x).toBeGreaterThanOrEqual(web.x);
    expect(child.y).toBeGreaterThan(web.y);
    expect(child.x + child.width).toBeLessThanOrEqual(web.x + web.width + 1);
    expect(child.y + child.height).toBeLessThanOrEqual(web.y + web.height + 1);
  }

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(boxes).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand WEB01" })).toContainText("2");
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(boxes).toHaveCount(2);
});

test("selecting a resource shows its details and impact", async ({ page }) => {
  await page.goto(map);
  await node(page, "SQL01").click({ position: { x: 60, y: 12 } });
  const details = page.getByRole("complementary", { name: "SQL01 details" });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: /Impact/ }).click();
  // orders-db, shop, billing and shop.example.com; the NAS backup does not propagate.
  await expect(page.getByText(/If\s+SQL01\s+fails,\s+4\s+could be affected/)).toBeVisible();
  await expect(page).toHaveURL(/impact=/);
});

test("saves a view with its boxes and positions, and opens it by link", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto(map);
  await page.getByRole("button", { name: "Collapse all" }).click();

  await expect(page.locator(".react-flow__node-box")).toHaveCount(0);
  await settle(page);

  // Dragging pins a resource.
  const nas = node(page, "NAS01");
  const box = (await nas.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + 60 + i * 15, box.y + box.height / 2 + i * 12);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Reset positions" })).toBeVisible();

  await page.getByRole("button", { name: /^Views/ }).click();
  await page.getByLabel("New view name").fill("Collapsed overview");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/view=/);

  // A fresh page from the link: same view, boxes still collapsed, pin kept.
  await page.reload();
  await expect(page.getByRole("button", { name: /Collapsed overview/ })).toBeVisible();
  await expect(page.locator(".react-flow__node-box")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset positions" })).toBeVisible();

  // Back to the whole map, then delete the view.
  await page.getByRole("button", { name: /Collapsed overview/ }).click();
  await page.getByRole("button", { name: /Whole map/ }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.locator(".react-flow__node-box")).toHaveCount(2);
  await page.getByRole("button", { name: /^Views/ }).click();
  await page.getByRole("button", { name: "Delete view Collapsed overview" }).click();
  await expect(page.getByText("No saved views yet.")).toBeVisible();
});
