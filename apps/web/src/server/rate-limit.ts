// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal fixed-window rate limiter (in memory, per process).
 * Good enough for a single instance; move to Postgres/Redis before running
 * several instances (docs/SECURITY.md).
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_KEYS) prune(now);
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count++;
  return {
    allowed: w.count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  };
}

function prune(now: number) {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  // Still full (under attack): drop everything rather than grow unbounded.
  if (windows.size >= MAX_KEYS) windows.clear();
}

/** Test helper. */
export function resetRateLimits() {
  windows.clear();
}
