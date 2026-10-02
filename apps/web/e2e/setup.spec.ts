// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first ten minutes, as a new user lives them: sign up (first account of
 * the installation), create the workspace, import a small infrastructure.
 * Saves the session for the other specs.
 */
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

/** A web shop and its database on two servers, a domain in front, a NAS for backups. */
export const INFRA = {
  resources: [
    { id: "web01", name: "WEB01", type: "SERVER", environment: "production", ips: "10.0.0.10" },
    {
      id: "sql01",
      name: "SQL01",
      type: "SERVER",
      environment: "production",
      criticality: "critical",
      ips: "10.0.0.40",
    },
    { id: "shop", name: "shop", type: "APPLICATION", environment: "production" },
    { id: "billing", name: "billing", type: "APPLICATION", environment: "production" },
    { id: "orders-db", name: "orders-db", type: "DATABASE", environment: "production" },
    { id: "shop-domain", name: "shop.example.com", type: "DOMAIN" },
    { id: "nas01", name: "NAS01", type: "STORAGE" },
  ],
  relationships: [
    { from: "shop", type: "RUNS_ON", to: "web01" },
    { from: "billing", type: "RUNS_ON", to: "web01" },
    { from: "orders-db", type: "RUNS_ON", to: "sql01" },
    { from: "shop", type: "USES_DATABASE", to: "orders-db" },
    { from: "billing", type: "USES_DATABASE", to: "orders-db" },
    { from: "shop-domain", type: "DEPENDS_ON", to: "shop" },
    { from: "orders-db", type: "BACKS_UP_TO", to: "nas01" },
  ],
};

test("sign up, create the workspace and import an infrastructure", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Workspace name").fill(OWNER.workspace);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${OWNER.slug}`));

  await page.goto(`/w/${OWNER.slug}/library/import`);
  await page.getByLabel("Data to import").fill(JSON.stringify(INFRA, null, 2));
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("7 created");
  await expect(page.getByRole("status")).toContainText("7 relationships");

  await page.context().storageState({ path: "e2e/.auth/owner.json" });
});
