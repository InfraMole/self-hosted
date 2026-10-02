// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local sources (M27, ADR-042): allowed private networks, addresses that are
 * never reachable, and certificate pinning against a real TLS server with a
 * self-signed certificate (generated with openssl; skipped without it).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BlockedDestinationError,
  __testing,
  isAllowedLocal,
  normalizeFingerprint,
  parseCidrs,
  safeFetch,
} from "./safe-fetch";

describe("private networks", () => {
  const allowed = parseCidrs("192.168.1.0/24, 10.20.0.0/16, fd00:1234::/32");

  it("parses networks and refuses anything else", () => {
    expect(allowed.map((c) => c.text)).toEqual([
      "192.168.1.0/24",
      "10.20.0.0/16",
      "fd00:1234::/32",
    ]);
    expect(() => parseCidrs("192.168.1.0")).toThrow(/not a network/);
    expect(() => parseCidrs("0.0.0.0/0")).toThrow(/not a network/); // everything: never
    expect(() => parseCidrs("lan")).toThrow(/not a network/);
  });

  it.each([
    ["192.168.1.40", true],
    ["192.168.2.40", false],
    ["10.20.5.5", true],
    ["fd00:1234::9", true],
    ["fd00:9999::9", false],
    ["8.8.8.8", true], // public addresses stay reachable
  ])("%s allowed: %s", (ip, ok) => expect(isAllowedLocal(ip, allowed)).toBe(ok));

  it("never reaches this machine, link-local (cloud metadata) or multicast, even if listed", () => {
    const everything = parseCidrs("127.0.0.0/8, 169.254.0.0/16, 0.0.0.0/8, 224.0.0.0/8");
    for (const ip of [
      "127.0.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ])
      expect(isAllowedLocal(ip, everything), ip).toBe(false);
  });

  it("refuses a private literal outside the allowed networks, and http", async () => {
    const local = { allowed };
    await expect(safeFetch("https://192.168.2.1:8006/", { local })).rejects.toThrow(
      /not in INTEGRATIONS_PRIVATE_NETWORKS/,
    );
    await expect(safeFetch("http://192.168.1.10/", { local })).rejects.toBeInstanceOf(
      BlockedDestinationError,
    );
    // Cloud integrations (no `local`) still never reach private networks.
    await expect(safeFetch("https://192.168.1.10/")).rejects.toThrow(/is not public/);
  });

  it("normalises fingerprints", () => {
    expect(normalizeFingerprint("4cca fc4f")).toBe("4C:CA:FC:4F");
    expect(normalizeFingerprint("4C:CA:FC:4F")).toBe("4C:CA:FC:4F");
  });
});

let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}

describe.skipIf(!openssl)("certificate pinning (self-signed test server)", () => {
  let server: Server;
  let url: string;
  let fingerprint: string;
  let hits = 0;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inframole-tls-"));
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
        "/CN=localhost",
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
    server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("accepts the pinned self-signed certificate", async () => {
    const res = await fetch(url, { dispatcher: __testing.localAgentAllowingLoopback(fingerprint) });
    expect(await res.text()).toBe('{"ok":true}');
  });

  it("checks every connection, not only the first (no TLS session resumption)", async () => {
    const agent = __testing.localAgentAllowingLoopback(fingerprint);
    await fetch(url, { dispatcher: agent }).then((r) => r.text());
    const many = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => fetch(`${url}${i}`, { dispatcher: agent }).then((r) => r.text())),
    );
    expect(many).toEqual(Array(5).fill('{"ok":true}'));
  });

  it("refuses another certificate before sending the request", async () => {
    const before = hits;
    const wrong = "AA:".repeat(31) + "AA";
    const err = await fetch(url, { dispatcher: __testing.localAgentAllowingLoopback(wrong) }).catch(
      (e: unknown) => e,
    );
    let cause: unknown = err;
    while (cause && !(cause instanceof BlockedDestinationError))
      cause = (cause as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(BlockedDestinationError);
    expect(String((cause as Error).message)).toMatch(/not the pinned one/);
    expect(hits).toBe(before); // the request never reached the server
  });

  it("explains an untrusted certificate", async () => {
    // A real handshake failure (safeFetch itself never reaches loopback).
    const err = await fetch(url, { dispatcher: __testing.localAgentAllowingLoopback() }).catch(
      (e: unknown) => e,
    );
    expect(__testing.certificateError(err)?.message).toMatch(
      /certificate is not trusted .* pin its SHA-256 fingerprint/,
    );
  });

  it("without a pin, a self-signed certificate is not trusted", async () => {
    await expect(
      fetch(url, { dispatcher: __testing.localAgentAllowingLoopback() }),
    ).rejects.toThrow();
  });
});
