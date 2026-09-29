// SPDX-License-Identifier: AGPL-3.0-only
/** Pure change-diff helpers for ChangeEvent.diff (bounded, human-readable). */

export const DIFF_FIELDS = [
  "name",
  "type",
  "environment",
  "criticality",
  "status",
  "description",
  "notes",
  "tags",
  "links",
  "metadata",
] as const;
export type DiffField = (typeof DIFF_FIELDS)[number];

export type ResourceSnapshot = Record<DiffField, unknown>;
export type ResourceDiff = Partial<Record<DiffField, [unknown, unknown]>>;

const MAX_STRING = 200;

function bounded(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`;
  }
  return value ?? null;
}

/** JSON with object keys sorted: Postgres JSONB does not preserve key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export function diffResource(before: ResourceSnapshot, after: ResourceSnapshot): ResourceDiff {
  const diff: ResourceDiff = {};
  for (const field of DIFF_FIELDS) {
    if (!same(before[field], after[field])) {
      diff[field] = [bounded(before[field]), bounded(after[field])];
    }
  }
  return diff;
}

export function updateSummary(name: string, diff: ResourceDiff): string {
  const fields = Object.keys(diff);
  return `Updated ${name}: ${fields.join(", ")}`;
}
