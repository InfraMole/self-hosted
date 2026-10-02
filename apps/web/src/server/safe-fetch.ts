// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Outbound HTTP for integrations (ADR-018 D, SECURITY T17 — SSRF).
 *
 * - https only; no redirects (APIs we call never need them).
 * - Destination must be a PUBLIC address. The check runs at CONNECT time on
 *   every resolved address (custom lookup in the undici Agent), so DNS
 *   rebinding cannot swap in a private IP after validation.
 * - Timeout and response-size cap; response body returned as text.
 *
 * Local sources (M27, ADR-042: Proxmox, TrueNAS, Synology) may also reach
 * the private networks the administrator listed (INTEGRATIONS_PRIVATE_NETWORKS,
 * self-hosted only) — never loopback, link-local (cloud metadata),
 * unspecified or multicast addresses — and may pin a self-signed certificate
 * by its SHA-256 fingerprint instead of trusting a CA. Verification is never
 * simply turned off.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { Agent, WebSocket, buildConnector, fetch } from "undici";

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

// ───────────────────────── local networks (M27) ─────────────────────────

export interface Cidr {
  version: 4 | 6;
  /** 32-bit integer (v4) or 8 hextets (v6). */
  base: number | number[];
  bits: number;
  text: string;
}

/** "192.168.1.0/24, 10.0.0.0/8, fd00::/8" → CIDRs. Throws on anything else. */
export function parseCidrs(text: string): Cidr[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const [ip = "", bitsText = ""] = item.split("/");
      const version = isIP(ip);
      const bits = Number(bitsText);
      const max = version === 4 ? 32 : 128;
      if (!version || !/^\d{1,3}$/.test(bitsText) || bits < 8 || bits > max)
        throw new Error(`"${item}" is not a network like 192.168.1.0/24 (prefix /8 or longer)`);
      return version === 4
        ? { version: 4 as const, base: ipv4ToInt(ip), bits, text: item }
        : { version: 6 as const, base: expandV6(ip), bits, text: item };
    });
}

function inCidr(ip: string, cidr: Cidr): boolean {
  const version = isIP(ip);
  if (version !== cidr.version) return false;
  if (version === 4) {
    const mask = cidr.bits === 0 ? 0 : (~0 << (32 - cidr.bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) >>> 0 === ((cidr.base as number) & mask) >>> 0;
  }
  const g = expandV6(ip);
  const base = cidr.base as number[];
  for (let i = 0, left = cidr.bits; left > 0; i++, left -= 16) {
    const mask = left >= 16 ? 0xffff : (0xffff << (16 - left)) & 0xffff;
    if ((g[i]! & mask) !== (base[i]! & mask)) return false;
  }
  return true;
}

/** Never reachable, whatever the administrator allowed: this machine, metadata, multicast. */
function isAlwaysBlocked(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    const inV4 = (base: string, bits: number) => {
      const mask = (~0 << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    };
    return (
      inV4("0.0.0.0", 8) || inV4("127.0.0.0", 8) || inV4("169.254.0.0", 16) || inV4("224.0.0.0", 3)
    );
  }
  if (isIP(ip) === 6) {
    const g = expandV6(ip);
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
      return isAlwaysBlocked(`${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`);
    const first = g[0]!;
    return (
      g.every((x) => x === 0) ||
      (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00
    );
  }
  return true;
}

export interface LocalNetwork {
  /** Private networks the administrator allowed (INTEGRATIONS_PRIVATE_NETWORKS). */
  allowed: readonly Cidr[];
  /** SHA-256 fingerprint of the server certificate ("AB:CD:…"); unset = CA verification. */
  pin?: string;
}

/** A local source may reach public addresses and the allowed private networks. */
export function isAllowedLocal(ip: string, allowed: readonly Cidr[]): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (isAlwaysBlocked(bare)) return false;
  return isPublicAddress(bare) || allowed.some((c) => inCidr(bare, c));
}

/** "ab:cd…" / "ABCD…" → "AB:CD:…" (the format Node reports). */
export function normalizeFingerprint(pin: string): string {
  const hex = pin.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return hex.match(/.{2}/g)?.join(":") ?? "";
}

// ───────────────────────── fetch ─────────────────────────

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** dns.lookup wrapper that rejects any address `ok` refuses (runs at connect time). */
function guardFor(ok: (ip: string) => boolean, reason: (host: string, ip: string) => string) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const bad = addresses.find((a) => !ok(a.address));
      if (bad || addresses.length === 0) {
        return callback(
          new BlockedDestinationError(reason(hostname, bad?.address ?? "nothing")),
          [],
        );
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const guardedLookup = guardFor(
  isPublicAddress,
  (host) => `${host} resolves to a non-public address`,
);

const publicOnlyAgent = new Agent({
  connect: { lookup: guardedLookup as never },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

const localAgents = new Map<string, Agent>();

/** Agent for a local source: allowed networks at connect time, optional certificate pin. */
function localAgent(local: LocalNetwork, testOnlyAllow?: (ip: string) => boolean): Agent {
  const pin = local.pin ? normalizeFingerprint(local.pin) : undefined;
  const key = `${local.allowed.map((c) => c.text).join(",")}|${pin ?? ""}`;
  let agent = testOnlyAllow ? undefined : localAgents.get(key);
  if (agent) return agent;
  const lookup = guardFor(
    testOnlyAllow ?? ((ip) => isAllowedLocal(ip, local.allowed)),
    (host, ip) =>
      `${host} resolves to ${ip}, which is not public and not in INTEGRATIONS_PRIVATE_NETWORKS`,
  );
  // A pinned certificate replaces CA verification: the chain is not checked,
  // the exact certificate is (before any byte of the request is sent).
  const base = buildConnector({
    lookup: lookup as never,
    ...(pin ? { rejectUnauthorized: false } : {}),
  });
  const connect: buildConnector.connector = (opts, callback) =>
    base(opts, (err, socket) => {
      if (err || !socket) return callback(err ?? new Error("connect failed"), null);
      if (pin) {
        const seen = (socket as Socket as TLSSocket).getPeerCertificate?.()?.fingerprint256;
        if (!seen || normalizeFingerprint(seen) !== pin) {
          socket.destroy();
          return callback(
            new BlockedDestinationError(
              `the certificate's SHA-256 fingerprint is ${seen ?? "unknown"}, not the pinned one`,
            ),
            null,
          );
        }
      }
      callback(null, socket);
    });
  agent = new Agent({ connect, headersTimeout: 15_000, bodyTimeout: 15_000 });
  if (!testOnlyAllow) localAgents.set(key, agent);
  return agent;
}

/** TESTS ONLY: the local agent against a loopback test server (always blocked otherwise). */
export const __testing = {
  localAgentAllowingLoopback: (pin?: string) => localAgent({ allowed: [], pin }, () => true),
};

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** TESTS ONLY: allow http and private destinations (local fake servers). */
  unsafeAllowPrivateForTests?: boolean;
  /** Local sources only (M27): allowed private networks and certificate pin. */
  local?: LocalNetwork;
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
  if (!unsafe) checkUrl(parsed, "https:", options.local);

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      ...(unsafe
        ? {}
        : { dispatcher: options.local ? localAgent(options.local) : publicOnlyAgent }),
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

function checkUrl(parsed: URL, protocol: "https:" | "wss:", local?: LocalNetwork) {
  if (parsed.protocol !== protocol)
    throw new BlockedDestinationError(`only ${protocol}// is allowed`);
  if (parsed.username || parsed.password) throw new BlockedDestinationError("credentials in URL");
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !(local ? isAllowedLocal(host, local.allowed) : isPublicAddress(host)))
    throw new BlockedDestinationError(
      local
        ? `${host} is not public and not in INTEGRATIONS_PRIVATE_NETWORKS`
        : `${host} is not public`,
    );
}

// ───────────────────────── JSON-RPC over WebSocket (TrueNAS, M27) ─────────────────────────

export interface RpcSession {
  call<T>(method: string, params?: unknown[]): Promise<T>;
  close(): void;
}

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * A JSON-RPC 2.0 session on a wss:// endpoint of a local source, with the
 * same destination rules as safeFetch (allowed networks, certificate pin).
 * Each call has a timeout; messages larger than `maxBytes` end the session.
 */
export async function safeJsonRpc(
  url: string,
  local: LocalNetwork,
  { timeoutMs = 20_000, maxBytes = 10 * 1024 * 1024 } = {},
): Promise<RpcSession> {
  checkUrl(new URL(url), "wss:", local);
  const ws = new WebSocket(url, { dispatcher: localAgent(local) } as never);
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let failure: Error | null = null;
  const failAll = (error: Error) => {
    failure ??= error;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new RpcError("the server did not answer in time"));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      // undici reports connect errors (including our blocks) as the event's error.
      let cause: unknown = (event as unknown as { error?: unknown }).error;
      for (let e = cause; e; e = (e as { cause?: unknown }).cause)
        if (e instanceof BlockedDestinationError) cause = e;
      reject(cause instanceof BlockedDestinationError ? cause : new RpcError("could not connect"));
    });
  });
  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : "";
    if (text.length > maxBytes) {
      failAll(new BlockedDestinationError(`response larger than ${maxBytes} bytes`));
      ws.close();
      return;
    }
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string; data?: { reason?: string } };
    };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const p = typeof msg.id === "number" ? pending.get(msg.id) : undefined;
    if (!p) return;
    pending.delete(msg.id!);
    if (msg.error)
      p.reject(
        new RpcError((msg.error.data?.reason ?? msg.error.message ?? "error").slice(0, 200)),
      );
    else p.resolve(msg.result);
  });
  ws.addEventListener("close", () => failAll(new RpcError("the connection was closed")));
  let next = 1;
  return {
    call<T>(method: string, params: unknown[] = []) {
      if (failure) return Promise.reject(failure);
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new RpcError(`${method} did not answer in time`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v as T);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}
