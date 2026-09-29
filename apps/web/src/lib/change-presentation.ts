// SPDX-License-Identifier: AGPL-3.0-only
import type { ChangeKind } from "@/generated/prisma/enums";

/** Diff-style marker per change kind — shared by Activity and the Changes feed. */
export const CHANGE_KINDS: Record<ChangeKind, { sign: string; className: string; label: string }> =
  {
    CREATED: { sign: "+", className: "text-success", label: "Created" },
    DISCOVERED: { sign: "+", className: "text-accent", label: "Discovered" },
    UPDATED: { sign: "~", className: "text-warning", label: "Updated" },
    CONFIRMED: { sign: "✓", className: "text-success", label: "Confirmed" },
    IGNORED: { sign: "×", className: "text-subtle", label: "Ignored" },
    NO_LONGER_OBSERVED: { sign: "−", className: "text-warning", label: "No longer observed" },
    DELETED: { sign: "−", className: "text-danger", label: "Deleted" },
  };
