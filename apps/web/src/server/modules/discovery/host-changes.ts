// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "What changed on this host?" — pure helpers (unit tested) used by ingestion
 * to turn consecutive agent observations into readable ChangeEvents (M7).
 */

export interface ObservedState {
  /** Names of running services. */
  services: string[];
  /** Distinct listening TCP ports. */
  ports: number[];
}

export interface ObservationDiff {
  servicesStarted: string[];
  servicesStopped: string[];
  portsOpened: number[];
  portsClosed: number[];
}

type ReportLike = {
  services?: { name: string; state: string }[];
  listeners?: { port: number }[];
};

export function observedState(report: ReportLike | null | undefined): ObservedState {
  const services = new Set(
    (report?.services ?? []).filter((s) => s.state === "running").map((s) => s.name),
  );
  const ports = new Set((report?.listeners ?? []).map((l) => l.port));
  return {
    services: [...services].sort(),
    ports: [...ports].sort((a, b) => a - b),
  };
}

/** Null when nothing relevant changed (or there is no baseline yet). */
export function diffObserved(
  previous: ObservedState | null,
  current: ObservedState,
): ObservationDiff | null {
  if (!previous) return null; // first report = baseline, not a change
  const minus = <T>(a: T[], b: T[]) => {
    const set = new Set(b);
    return a.filter((x) => !set.has(x));
  };
  const diff: ObservationDiff = {
    servicesStarted: minus(current.services, previous.services),
    servicesStopped: minus(previous.services, current.services),
    portsOpened: minus(current.ports, previous.ports),
    portsClosed: minus(previous.ports, current.ports),
  };
  return Object.values(diff).some((list) => list.length > 0) ? diff : null;
}

const MAX_LISTED = 5;

function list<T>(items: T[]): string {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown} +${items.length - MAX_LISTED} more` : shown;
}

export function describeObservationDiff(host: string, diff: ObservationDiff): string {
  const parts: string[] = [];
  if (diff.servicesStarted.length) parts.push(`new services ${list(diff.servicesStarted)}`);
  if (diff.servicesStopped.length) parts.push(`stopped ${list(diff.servicesStopped)}`);
  if (diff.portsOpened.length) parts.push(`new listening ports ${list(diff.portsOpened)}`);
  if (diff.portsClosed.length) parts.push(`closed ports ${list(diff.portsClosed)}`);
  return `${host}: ${parts.join("; ")}`;
}

/** Bounded diff payload for ChangeEvent.diff (≤ 50 items per list). */
export function boundedDiff(diff: ObservationDiff) {
  const cap = <T>(items: T[]) => items.slice(0, 50);
  return {
    servicesStarted: cap(diff.servicesStarted),
    servicesStopped: cap(diff.servicesStopped),
    portsOpened: cap(diff.portsOpened),
    portsClosed: cap(diff.portsClosed),
  };
}

/** "APP01 IP changed: 10.0.0.23 → 10.0.0.99" (null when the set is unchanged). */
export function describeIpChange(host: string, before: string[], after: string[]): string | null {
  const b = [...new Set(before)].sort();
  const a = [...new Set(after)].sort();
  if (b.join() === a.join()) return null;
  const from = b.length ? b.join(", ") : "none";
  const to = a.length ? a.join(", ") : "none";
  return `${host} IP changed: ${from} → ${to}`;
}

/** An agent is stale after missing 3 report intervals (docs/DISCOVERY.md §3). */
export function isStale(lastSeenAt: Date | null, reportIntervalSec: number, now: Date): boolean {
  if (!lastSeenAt) return false; // never reported: "waiting", not "gone"
  return now.getTime() - lastSeenAt.getTime() > reportIntervalSec * 3 * 1000;
}
