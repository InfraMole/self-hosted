// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { clientIp, readJsonLimited } from "./http";
import { rateLimit, resetRateLimits } from "./rate-limit";

const req = (
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
) => new Request("http://x/api", { method: "POST", body, headers });

describe("readJsonLimited", () => {
  it("parses JSON within the limit", async () => {
    expect(await readJsonLimited(req('{"a":1}'), 100)).toEqual({
      ok: true,
      value: { a: 1 },
      bytes: 7,
    });
  });

  it("rejects oversized bodies even without Content-Length", async () => {
    const result = await readJsonLimited(req("x".repeat(200)), 100);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects a large declared Content-Length early", async () => {
    const result = await readJsonLimited(
      req("{}", { "content-type": "application/json", "content-length": "5000" }),
      100,
    );
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects non-JSON content types and invalid JSON", async () => {
    expect(await readJsonLimited(req("{}", { "content-type": "text/plain" }), 100)).toMatchObject({
      status: 415,
    });
    expect(await readJsonLimited(req("{nope"), 100)).toMatchObject({ status: 400 });
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("direct: rightmost X-Forwarded-For (closest hop), never X-Real-IP", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), false)).toBe("203.0.113.9");
    expect(clientIp(req({ "x-real-ip": "6.6.6.6" }), false)).toBe("unknown");
    expect(clientIp(req({}), false)).toBe("unknown");
  });

  it("behind the proxy: X-Real-IP set by the proxy wins over a client-sent X-Forwarded-For", () => {
    const r = req({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 198.51.100.4" });
    expect(clientIp(r, true)).toBe("198.51.100.4");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }), true)).toBe(
      "198.51.100.4",
    );
    expect(clientIp(req({ "x-real-ip": "2001:db8::1" }), true)).toBe("2001:db8::1");
  });

  it("ignores values that are not IP addresses", () => {
    expect(clientIp(req({ "x-real-ip": "<script>", "x-forwarded-for": "evil" }), true)).toBe(
      "unknown",
    );
  });
});

describe("rateLimit", () => {
  it("allows up to the limit per window, then resets", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 1000, t0).allowed).toBe(true);
    const blocked = rateLimit("k", 3, 1000, t0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect(rateLimit("k", 3, 1000, t0 + 1001).allowed).toBe(true);
    expect(rateLimit("other", 3, 1000, t0).allowed).toBe(true);
  });
});
