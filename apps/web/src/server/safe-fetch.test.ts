// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlockedDestinationError, isPublicAddress, safeFetch } from "./safe-fetch";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "20.50.1.2",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("safeFetch guards", () => {
  it("rejects http, private literals, credentials in URL and private DNS names", async () => {
    await expect(safeFetch("http://example.com")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://127.0.0.1/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://[::1]/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      BlockedDestinationError,
    );
    await expect(safeFetch("https://user:pw@example.com/")).rejects.toBeInstanceOf(
      BlockedDestinationError,
    );
    // "localhost" resolves to a loopback address: blocked at connect time.
    await expect(safeFetch("https://localhost/")).rejects.toThrow(
      /resolves to a non-public address/,
    );
  });
});

describe("safeFetch behaviour (local fake server, test-only mode)", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/" }).end();
      } else if (req.url === "/big") {
        res.writeHead(200).end("x".repeat(5000));
      } else if (req.url === "/slow") {
        setTimeout(() => res.writeHead(200).end("late"), 2000);
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const unsafe = { unsafeAllowPrivateForTests: true } as const;

  it("returns status and body", async () => {
    const res = await safeFetch(`${base}/`, unsafe);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true });
  });

  it("never follows redirects", async () => {
    await expect(safeFetch(`${base}/redirect`, unsafe)).rejects.toThrow(
      /redirects are not followed/,
    );
  });

  it("caps the response size", async () => {
    await expect(safeFetch(`${base}/big`, { ...unsafe, maxBytes: 1000 })).rejects.toThrow(
      /larger than/,
    );
  });

  it("times out", async () => {
    await expect(safeFetch(`${base}/slow`, { ...unsafe, timeoutMs: 200 })).rejects.toThrow();
  });
});
