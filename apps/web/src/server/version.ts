// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { after } from "next/server";
import { compareVersions, type ReleaseProduct } from "@/lib/changelog";
import { getEnv } from "@/server/env";
import { safeFetch } from "@/server/safe-fetch";

export { compareVersions };

/**
 * Which InfraMole is running (M29) and whether a newer server or agent exists
 * (M36). The release images bake the version in at build time
 * (INFRAMOLE_BUILD_VERSION); a source build says "development". The update
 * check (UPDATE_CHECK=true, on in new installations since M36, ADR-052) is
 * one anonymous GET of each product's latest public release, at most once a
 * day — nothing is sent, no telemetry either way.
 */
export function currentVersion(): string | null {
  const v = getEnv().INFRAMOLE_BUILD_VERSION?.replace(/^v/, "");
  return v && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

const RELEASES: Record<ReleaseProduct, string> = {
  server: "https://api.github.com/repos/InfraMole/self-hosted/releases/latest",
  agent: "https://api.github.com/repos/InfraMole/agent/releases/latest",
};
const DAY = 24 * 60 * 60 * 1000;
/** "Check now" cannot hit GitHub more often than this (60 anonymous calls/hour per IP). */
export const CHECK_NOW_INTERVAL = 60 * 1000;

interface Checked {
  at: number;
  latest: string | null;
}
const cache = new Map<ReleaseProduct, Checked>();
const inFlight = new Map<ReleaseProduct, Promise<string | null>>();

async function fetchLatest(product: ReleaseProduct): Promise<string | null> {
  try {
    const res = await safeFetch(RELEASES[product], {
      headers: { accept: "application/vnd.github+json", "user-agent": "InfraMole" },
      timeoutMs: 4000,
      maxBytes: 512 * 1024,
    });
    if (res.status !== 200) return null;
    const tag = (JSON.parse(res.text) as { tag_name?: unknown }).tag_name;
    const v = typeof tag === "string" ? tag.replace(/^v/, "") : "";
    return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    // Offline or blocked: say nothing rather than something wrong.
    return null;
  }
}

/**
 * The latest published version of the server or the agent, or null (check
 * off, offline, rate-limited…). Cached for a day; `maxAge` shortens that
 * ("Check now").
 */
export async function latestVersion(
  product: ReleaseProduct = "server",
  options: { now?: number; maxAge?: number } = {},
): Promise<string | null> {
  if (!getEnv().UPDATE_CHECK) return null;
  const now = options.now ?? Date.now();
  const hit = cache.get(product);
  if (hit && now - hit.at < (options.maxAge ?? DAY)) return hit.latest;
  const pending = inFlight.get(product);
  if (pending) return pending;
  const request = fetchLatest(product)
    .then((latest) => {
      cache.set(product, { at: now, latest });
      return latest;
    })
    .finally(() => inFlight.delete(product));
  inFlight.set(product, request);
  return request;
}

export interface VersionInfo {
  current: string | null;
  /** Set only when the check is on and a newer release exists. */
  newer: string | null;
  /** Latest agent release, when the check is on and it answered. */
  latestAgent: string | null;
  checking: boolean;
  /** When GitHub was last asked (server release), if ever since start. */
  checkedAt: Date | null;
}

function info(current: string | null, latest: string | null, latestAgent: string | null) {
  const checking = getEnv().UPDATE_CHECK;
  const at = cache.get("server")?.at;
  return {
    current,
    newer: latest && current && compareVersions(latest, current) > 0 ? latest : null,
    latestAgent,
    checking,
    checkedAt: checking && at ? new Date(at) : null,
  };
}

/** Asks GitHub when the cached answer is older than a day (Settings, digest). */
export async function versionInfo(options: { maxAge?: number } = {}): Promise<VersionInfo> {
  const current = currentVersion();
  const [latest, latestAgent] = await Promise.all([
    current ? latestVersion("server", options) : null,
    latestVersion("agent", options),
  ]);
  return info(current, latest, latestAgent);
}

/**
 * What is already known, without waiting for the network (every page of the
 * app shell): a stale or empty cache is refreshed after the response.
 */
export function cachedVersionInfo(now = Date.now()): VersionInfo {
  const current = currentVersion();
  if (getEnv().UPDATE_CHECK) {
    const stale = (["server", "agent"] as const).some((p) => {
      const hit = cache.get(p);
      return !hit || now - hit.at >= DAY;
    });
    if (stale) after(() => versionInfo().then(() => undefined));
  }
  return info(current, cache.get("server")?.latest ?? null, cache.get("agent")?.latest ?? null);
}

/** Agents older than the latest agent release (null when unknown). */
export function agentBehind(agentVersion: string, latestAgent: string | null): boolean {
  const v = agentVersion.replace(/^v/, "");
  return Boolean(latestAgent && /^\d+\.\d+\.\d+$/.test(v) && compareVersions(latestAgent, v) > 0);
}
