// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An integration end to end, through the real server path: a fake Proxmox VE
 * API over TLS with a self-signed certificate, on this machine's private IP.
 * The server reaches it only because that /32 is in
 * INTEGRATIONS_PRIVATE_NETWORKS, and accepts the certificate only by its
 * pinned SHA-256 fingerprint (ADR-042). No test hook in the application.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FAKE_PROXMOX_PORT, OWNER, PRIVATE_IP } from "./env";

const TOKEN_ID = "inframole@pve!e2e";
const TOKEN_SECRET = "6f1b2c3d-1111-2222-3333-444455556666";

let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}

test.describe("Proxmox through a local network", () => {
  test.skip(!PRIVATE_IP || !openssl, "needs a private IPv4 and openssl");

  let server: Server;
  let fingerprint = "";
  let authorized = 0;

  test.beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inframole-e2e-"));
    const key = path.join(dir, "key.pem");
    const cert = path.join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=pve.e2e",
      ],
      { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
    );
    fingerprint = execFileSync("openssl", [
      "x509",
      "-in",
      cert,
      "-noout",
      "-fingerprint",
      "-sha256",
    ])
      .toString()
      .split("=")[1]!
      .trim();
    const data: Record<string, unknown> = {
      "/api2/json/cluster/resources": [
        { id: "node/pve-e2e", type: "node", node: "pve-e2e", status: "online" },
        {
          id: "qemu/100",
          type: "qemu",
          node: "pve-e2e",
          vmid: 100,
          name: "e2e-vm",
          status: "running",
        },
        {
          id: "lxc/200",
          type: "lxc",
          node: "pve-e2e",
          vmid: 200,
          name: "e2e-ct",
          status: "stopped",
        },
      ],
      "/api2/json/cluster/status": [{ type: "node", name: "pve-e2e", ip: PRIVATE_IP }],
    };
    server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      if (req.headers.authorization !== `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`) {
        res.writeHead(401).end();
        return;
      }
      authorized++;
      const body = data[req.url ?? ""];
      res.writeHead(body ? 200 : 403, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: body ?? null }));
    });
    await new Promise<void>((r) => server.listen(FAKE_PROXMOX_PORT, PRIVATE_IP, r));
  });
  test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

  test("test connection, then save and sync", async ({ page }) => {
    await page.goto(`/w/${OWNER.slug}/settings`);
    await page.getByRole("button", { name: "Add integration" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.locator("#kind").selectOption("PROXMOX");
    await expect(sheet).toContainText("INTEGRATIONS_PRIVATE_NETWORKS");
    await sheet.locator("#int-name").fill("Lab Proxmox");
    await sheet.locator("#f-url").fill(`https://${PRIVATE_IP}:${FAKE_PROXMOX_PORT}`);
    await sheet.locator("#f-tokenId").fill(TOKEN_ID);
    await sheet.locator("#f-tokenSecret").fill(TOKEN_SECRET);

    // Without the pin, the self-signed certificate is refused.
    await sheet.getByRole("button", { name: "Test connection" }).click();
    await expect(sheet.getByRole("status")).toContainText(
      /certificate is not trusted .* pin its SHA-256 fingerprint/,
    );
    expect(authorized).toBe(0);

    await sheet.locator("#f-fingerprint").fill(fingerprint);
    await sheet.getByRole("button", { name: "Test connection" }).click();
    await expect(sheet.getByRole("status")).toContainText(/Connected\. An import would create/);
    expect(authorized).toBeGreaterThan(0);

    await sheet.getByRole("button", { name: "Save & sync" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Lab Proxmox")).toBeVisible();
    await expect(page.getByText(/\d+ created, \d+ updated/)).toBeVisible();

    await page.goto(`/w/${OWNER.slug}/library`);
    for (const name of ["pve-e2e", "e2e-vm", "e2e-ct"])
      await expect(page.locator("tbody tr").filter({ hasText: name })).toBeVisible();
  });
});
