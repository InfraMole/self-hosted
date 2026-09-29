// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Outbound HTTP for integrations (ADR-018 D, SECURITY T17 — SSRF).
 *
 * - https only; no redirects (APIs we call never need them).
 * - Destination must be a PUBLIC address. The check runs at CONNECT time on
 *   every resolved address (custom lookup in the undici Agent), so DNS
 *   rebinding cannot swap in a private IP after validation.
 * - Timeout and response-size cap; response body returned as text.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";

export class BlockedDestinationError extends Error {
  constructor(reason: string) {
    super(`Blocked outbound request: ${reason}`);
    this.name = "BlockedDestinationError";
  }
}

// ───────────────────────── address classification ─────────────────────────

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function isPublicV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to 8 hextets. */
function expandV6(ip: string): number[] {
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const parse = (s: string) => (s ? s.split(":") : []);
  let h = parse(head!);
  let t = parse(tail);
  // Embedded IPv4 in the last group (::ffff:1.2.3.4)
  const last = (t.length ? t : h).at(-1);
  if (last && last.includes(".")) {
    const n = ipv4ToInt(last);
    const parts = [(n >>> 16).toString(16), (n & 0xffff).toString(16)];
    if (t.length) t = [...t.slice(0, -1), ...parts];
    else h = [...h.slice(0, -1), ...parts];
  }
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip);
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped / NAT64 → judge the embedded IPv4
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isPublicV4(`${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return false;
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPublicV4(ip);
  if (version === 6) return isPublicV6(ip.replace(/^\[|\]$/g, ""));
  return false;
}

// ───────────────────────── fetch ─────────────────────────

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** dns.lookup wrapper that rejects any non-public address (runs at connect time). */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || addresses.length === 0) {
      return callback(
        new BlockedDestinationError(`${hostname} resolves to a non-public address`),
        [],
      );
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

const publicOnlyAgent = new Agent({
  connect: { lookup: guardedLookup as never },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** TESTS ONLY: allow http and private destinations (local fake servers). */
  unsafeAllowPrivateForTests?: boolean;
}

export interface SafeResponse {
  status: number;
  headers: Headers;
  text: string;
}

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const parsed = new URL(url);
  const unsafe = options.unsafeAllowPrivateForTests === true;
  if (!unsafe) {
    if (parsed.protocol !== "https:") throw new BlockedDestinationError("only https:// is allowed");
    if (parsed.username || parsed.password) throw new BlockedDestinationError("credentials in URL");
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublicAddress(host))
      throw new BlockedDestinationError(`${host} is not public`);
  }

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      ...(unsafe ? {} : { dispatcher: publicOnlyAgent }),
    });
  } catch (error) {
    // undici wraps connect errors ("fetch failed"): surface our own block reason.
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
      if (e instanceof BlockedDestinationError) throw e;
    }
    throw error;
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new BlockedDestinationError(`redirects are not followed (HTTP ${res.status})`);
  }

  const max = options.maxBytes ?? 10 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > max) {
        await res.body.cancel().catch(() => {});
        throw new BlockedDestinationError(`response larger than ${max} bytes`);
      }
      chunks.push(chunk);
    }
  }
  return {
    status: res.status,
    headers: res.headers as unknown as Headers,
    text: Buffer.concat(chunks).toString("utf8"),
  };
}
