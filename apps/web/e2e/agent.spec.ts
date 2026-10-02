// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An agent joins: the admin creates an enrollment token in Settings, an agent
 * (simulated with its real HTTP protocol and the Go agent's golden report)
 * enrolls and reports, and the host appears in the Library as Discovered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { OWNER } from "./env";

const golden = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../../agent/internal/protocol/testdata/report.golden.json"),
    "utf8",
  ),
) as Record<string, unknown> & { host: Record<string, unknown> };

test("enrollment token → agent enrolls and reports → host in the Library", async ({
  page,
  request,
}) => {
  await page.goto(`/w/${OWNER.slug}/settings`);
  await page.getByRole("button", { name: "New enrollment token" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator("#name").fill("E2E servers");
  await sheet.getByRole("button", { name: "Create token" }).click();
  await expect(sheet.getByText("Copy the token now")).toBeVisible();
  const token = (await sheet.textContent())?.match(/dmp_enr_[A-Za-z0-9_-]{43}/)?.[0];
  expect(token, "the token is shown once").toBeTruthy();

  const enroll = await request.post("/api/agent/v1/enroll", {
    data: {
      enrollmentToken: token,
      machineId: "e2e-machine-0001",
      hostname: "E2E-AGENT-01",
      os: "windows",
      osVersion: "10.0.20348",
      arch: "amd64",
      agentVersion: "0.6.0",
    },
  });
  expect(enroll.status()).toBe(201);
  const { agentSecret } = (await enroll.json()) as { agentSecret: string };
  expect(agentSecret).toMatch(/^dmp_agt_/);

  const now = Date.now();
  const report = await request.post("/api/agent/v1/report", {
    headers: { authorization: `Bearer ${agentSecret}` },
    data: {
      ...golden,
      collectedAt: new Date(now).toISOString(),
      windowStart: new Date(now - 5 * 60_000).toISOString(),
      host: { ...golden.host, hostname: "E2E-AGENT-01", fqdn: "e2e-agent-01.corp.local" },
    },
  });
  expect(report.status()).toBe(202);

  await page.goto(`/w/${OWNER.slug}/library`);
  // The host itself (its services and sites are listed as "… (E2E-AGENT-01)").
  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("link", { name: /(^|\s)E2E-AGENT-01$/ }) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Discovered");

  // The token is shown once: the settings list never repeats it.
  await page.goto(`/w/${OWNER.slug}/settings`);
  await expect(page.getByText(token!)).toHaveCount(0);
});
