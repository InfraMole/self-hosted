// SPDX-License-Identifier: AGPL-3.0-only
/** HTTP helpers for machine-facing route handlers (agent API). */
import { isIP } from "node:net";
import { getEnv } from "./env";

export type BodyResult =
  | { ok: true; value: unknown; bytes: number }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Reads a JSON body, aborting as soon as `maxBytes` is exceeded (the
 * Content-Length header is checked first but never trusted alone).
 */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<BodyResult> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "content_type_must_be_json" };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  if (!request.body) return { ok: false, status: 400, error: "empty_body" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413, error: "payload_too_large" };
    }
    chunks.push(value);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, value: JSON.parse(text), bytes: total };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Client IP for rate limiting / "last IP" (docs/DEPLOYMENT.md §Proxy).
 *
 * - TRUST_PROXY=true (behind our reverse proxy): `X-Real-IP`, which the
 *   proxy overwrites with the TCP peer address (Caddy `header_up`), else the
 *   rightmost `X-Forwarded-For` entry (appended by the proxy).
 * - TRUST_PROXY=false (direct): the rightmost `X-Forwarded-For` entry, which
 *   Next.js fills from the socket when the client sent none. `X-Real-IP` is
 *   ignored (client-controlled). A client can still send its own
 *   X-Forwarded-For here, so production must run behind the proxy.
 */
export function clientIp(request: Request, trustProxy = getEnv().TRUST_PROXY): string {
  return ipFromHeaders(request.headers, trustProxy);
}

/** Same rule for server actions and pages (`await headers()`). */
export function ipFromHeaders(headers: Headers, trustProxy = getEnv().TRUST_PROXY): string {
  const valid = (v: string | undefined) => (v && isIP(v) ? v : undefined);
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim());
  const rightmost = valid(forwarded?.at(-1));
  if (trustProxy) return valid(headers.get("x-real-ip")?.trim()) ?? rightmost ?? "unknown";
  return rightmost ?? "unknown";
}
