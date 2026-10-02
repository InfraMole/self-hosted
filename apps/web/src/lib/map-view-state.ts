// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a saved map view remembers (M26 phase 3, ADR-041): filters, focus or
 * impact, open / closed boxes and pinned positions. Client-safe: the map
 * captures and applies it, the server validates it before storing. Holds
 * resource ids only — names and data always come from the live graph, and
 * ids that no longer exist are dropped when the view is applied.
 */
import { z } from "zod";
import { Environment, ResourceType } from "@/generated/prisma/enums";

export const SAVED_VIEWS_LIMIT = 50;
/** Bounds for one view: a 2,000-server map pins at most this many nodes. */
export const PINNED_LIMIT = 5000;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const coordinate = z.number().finite().min(-1e7).max(1e7);

export const savedViewStateSchema = z.object({
  type: z.enum(ResourceType).nullable().default(null),
  environment: z.enum(Environment).nullable().default(null),
  showUnconfirmed: z.boolean().default(false),
  showInformational: z.boolean().default(true),
  focus: z
    .object({
      id,
      depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(99)]),
      direction: z.enum(["both", "dependsOn", "usedBy"]),
    })
    .nullable()
    .default(null),
  impact: id.nullable().default(null),
  groupMode: z.enum(["auto", "expanded", "collapsed"]).default("auto"),
  /** Box id → expanded. */
  groups: z
    .record(id, z.boolean())
    .refine((r) => Object.keys(r).length <= PINNED_LIMIT, "Too many boxes")
    .default({}),
  /**
   * Resource id → position. `parent` is the box it was placed in (positions
   * inside a box are relative to it); a pin only applies while the resource
   * is drawn in that same box.
   */
  pinned: z
    .record(id, z.object({ x: coordinate, y: coordinate, parent: id.nullable() }))
    .refine((r) => Object.keys(r).length <= PINNED_LIMIT, "Too many pinned positions")
    .default({}),
});
export type SavedViewState = z.infer<typeof savedViewStateSchema>;

export const savedViewNameSchema = z
  .string()
  .trim()
  .min(1, "Give the view a name")
  .max(80, "Up to 80 characters");

export type ViewActionResult = { ok: true; id?: string } | { ok: false; error: string };

export interface SavedViewSummary {
  id: string;
  name: string;
  state: SavedViewState;
  updatedAt: string;
}

/**
 * Drops everything that points to a resource the map no longer has (deleted,
 * archived): the view still opens, without that part.
 */
export function sanitizeViewState(state: SavedViewState, has: (id: string) => boolean) {
  const keep = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([k]) => has(k)));
  return {
    ...state,
    focus: state.focus && has(state.focus.id) ? state.focus : null,
    impact: state.impact && has(state.impact) ? state.impact : null,
    groups: keep(state.groups),
    pinned: Object.fromEntries(
      Object.entries(state.pinned).filter(
        ([k, p]) => has(k) && (p.parent === null || has(p.parent)),
      ),
    ),
  } satisfies SavedViewState;
}

/** Same view? Key order and rounding never count as a change. */
export function sameViewState(a: SavedViewState, b: SavedViewState): boolean {
  return canonical(a) === canonical(b);
}

function canonical(state: SavedViewState): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
          )
        : typeof value === "number"
          ? Math.round(value)
          : value;
  return JSON.stringify(sorted(state));
}
