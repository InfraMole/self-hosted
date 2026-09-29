// SPDX-License-Identifier: AGPL-3.0-only
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Infinity],
];

/** "3 minutes ago", "yesterday". Render on the server only (avoids hydration drift). */
export function formatRelative(date: Date, now: Date = new Date()): string {
  let value = (date.getTime() - now.getTime()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), "year");
}

export function formatDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** "Today", "Yesterday" or "Mon 22 Sep 2026" (UTC, matching formatDateTime). */
export function formatDay(date: Date, now: Date = new Date()): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (day(date) === day(now)) return "Today";
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}
