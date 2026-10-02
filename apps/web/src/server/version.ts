// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { getEnv } from "@/server/env";
import { safeFetch } from "@/server/safe-fetch";

/**
 * Which InfraMole is running (M29). The release images bake the version in
 * at build time (INFRAMOLE_BUILD_VERSION); a source build says "development".
 * The update check is opt-in (UPDATE_CHECK=true, self-hosted admins): one
 * anonymous GET of the latest public release, at most once a day, nothing
 * sent — no telemetry either way.
 */
export function currentVersion(): string | null {
  const v = getEnv().INFRAMOLE_BUILD_VERSION?.replace(/^v/, "");
  return v && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

/** Compare "a.b.c" versions: positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

const RELEASES = "https://api.github.com/repos/InfraMole/self-hosted/releases/latest";
const DAY = 24 * 60 * 60 * 1000;
let cache: { at: number; latest: string | null } | null = null;

/** The latest published version, or null (check off, offline, rate-limited…). */
export async function latestVersion(now = Date.now()): Promise<string | null> {
  if (!getEnv().UPDATE_CHECK) return null;
  if (cache && now - cache.at < DAY) return cache.latest;
  let latest: string | null = null;
  try {
    const res = await safeFetch(RELEASES, {
      headers: { accept: "application/vnd.github+json", "user-agent": "InfraMole" },
      timeoutMs: 4000,
      maxBytes: 512 * 1024,
    });
    if (res.status === 200) {
      const tag = (JSON.parse(res.text) as { tag_name?: unknown }).tag_name;
      const v = typeof tag === "string" ? tag.replace(/^v/, "") : "";
      latest = /^\d+\.\d+\.\d+$/.test(v) ? v : null;
    }
  } catch {
    // Offline or blocked: say nothing rather than something wrong.
  }
  cache = { at: now, latest };
  return latest;
}

export interface VersionInfo {
  current: string | null;
  /** Set only when the check is on and a newer release exists. */
  newer: string | null;
  checking: boolean;
}

export async function versionInfo(): Promise<VersionInfo> {
  const current = currentVersion();
  const checking = getEnv().UPDATE_CHECK;
  const latest = checking && current ? await latestVersion() : null;
  return {
    current,
    newer: latest && current && compareVersions(latest, current) > 0 ? latest : null,
    checking,
  };
}
