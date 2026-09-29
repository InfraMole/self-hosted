// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Relationship type registry — the single source of truth for edge semantics
 * (docs/DATA_MODEL.md §4, ADR-007). Edges are stored as `from TYPE to`.
 *
 * `propagation` says in which direction *failure* flows:
 *  - "reverse": if `to` fails, `from` may be affected   (App USES_DATABASE SQL01)
 *  - "forward": if `from` fails, `to` may be affected   (PVE01 HOSTS VM12)
 *  - "none":    no propagation                          (APP01 MONITORED_BY Zabbix)
 */

export const RELATIONSHIP_TYPES = [
  "RUNS_ON",
  "HOSTS",
  "DEPENDS_ON",
  "CONNECTS_TO",
  "USES_DATABASE",
  "AUTHENTICATES_WITH",
  "EXPOSED_THROUGH",
  "STORES_DATA_IN",
  "BACKS_UP_TO",
  "MONITORED_BY",
  "CALLS",
  "LISTENS_ON",
  "OTHER",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type Propagation = "reverse" | "forward" | "none";

export interface RelationshipTypeInfo {
  /** Reads "from <label> to", e.g. "uses database". */
  label: string;
  /** Reads "to <inverseLabel> from", e.g. "database for". */
  inverseLabel: string;
  propagation: Propagation;
}

export const RELATIONSHIP_TYPE_INFO: Record<RelationshipType, RelationshipTypeInfo> = {
  RUNS_ON: { label: "runs on", inverseLabel: "hosts", propagation: "reverse" },
  HOSTS: { label: "hosts", inverseLabel: "runs on", propagation: "forward" },
  DEPENDS_ON: { label: "depends on", inverseLabel: "required by", propagation: "reverse" },
  CONNECTS_TO: {
    label: "connects to",
    inverseLabel: "receives connections from",
    propagation: "reverse",
  },
  USES_DATABASE: { label: "uses database", inverseLabel: "database for", propagation: "reverse" },
  AUTHENTICATES_WITH: {
    label: "authenticates with",
    inverseLabel: "authenticates",
    propagation: "reverse",
  },
  EXPOSED_THROUGH: { label: "exposed through", inverseLabel: "exposes", propagation: "reverse" },
  STORES_DATA_IN: {
    label: "stores data in",
    inverseLabel: "stores data for",
    propagation: "reverse",
  },
  BACKS_UP_TO: { label: "backs up to", inverseLabel: "backup target for", propagation: "none" },
  MONITORED_BY: { label: "monitored by", inverseLabel: "monitors", propagation: "none" },
  CALLS: { label: "calls", inverseLabel: "called by", propagation: "reverse" },
  LISTENS_ON: { label: "listens on", inverseLabel: "has listener", propagation: "reverse" },
  OTHER: { label: "related to", inverseLabel: "related to", propagation: "none" },
};

export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

// ───────────────────────── Confidence (ARCHITECTURE §6.2) ─────────────────────────

export type RelationshipOrigin = "MANUAL" | "DETECTED" | "INFERRED";
export type RelationshipStatus = "CONFIRMED" | "UNCONFIRMED" | "IGNORED";
export type Confidence = "confirmed" | "detected" | "inferred";

/** Strongest first. */
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  confirmed: 3,
  detected: 2,
  inferred: 1,
};

/** null = ignored (excluded from map and impact). */
export function edgeConfidence(
  status: RelationshipStatus,
  origin: RelationshipOrigin,
): Confidence | null {
  if (status === "IGNORED") return null;
  if (status === "CONFIRMED") return "confirmed";
  return origin === "INFERRED" ? "inferred" : "detected";
}
