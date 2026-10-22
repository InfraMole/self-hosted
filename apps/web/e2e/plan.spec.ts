// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan a change (M34): pick what changes in the Library, see what could be
 * affected and who to warn, open it on the map and export it as vector files.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

test("plans a change of two servers, shows it on the map and exports SVG and PDF", async ({
  page,
}) => {
  await page.goto(`/w/${OWNER.slug}/library`);
  await page.getByLabel("Select SQL01").check();
  await page.getByLabel("Select WEB01").check();
  await page.getByRole("button", { name: "Plan a change" }).click();
  await expect(page).toHaveURL(/\/plan\?ids=/);

  await page.getByLabel("Change", { exact: true }).fill("Patch SQL01 and WEB01");
  await page.getByLabel("When (optional)").fill("Sat 22:00–23:00");
  await page.getByLabel("When (optional)").press("Enter");
  await expect(page).toHaveURL(/title=Patch/);
  await expect(page).toHaveURL(/when=Sat/);

  const report = page.getByRole("article", { name: "Change report" });
  await expect(report.getByRole("heading", { name: "Patch SQL01 and WEB01" })).toBeVisible();
  await expect(report).toContainText(
    /If\s+SQL01 and WEB01\s+stop working,\s+4\s+other resources could be affected/,
  );
  for (const name of ["orders-db", "shop", "billing", "shop.example.com"])
    await expect(report.getByRole("link", { name, exact: true })).toBeVisible();
  // shop runs on WEB01 and uses orders-db on SQL01: both changes reach it.
  await expect(report.getByText(/reached from SQL01 and WEB01/).first()).toBeVisible();
  await expect(report).not.toContainText(/will break/i);

  await report.getByRole("link", { name: "Show on map" }).click();
  await expect(page).toHaveURL(/\/map\?impact=[^&]+%2C|\/map\?impact=[^&]+,/);
  await expect(
    page.getByText(/If\s+SQL01 and WEB01\s+fail,\s+4\s+could be affected/),
  ).toBeVisible();

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this view as SVG" }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  const svgText = await readFile((await svg.path())!, "utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain(">SQL01</text>");

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this view as PDF" }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfText = await readFile((await pdf.path())!, "latin1");
  expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
  expect(pdfText).toContain("(SQL01) Tj"); // real text, not a picture
});
