// SPDX-License-Identifier: AGPL-3.0-only
import type { Confidence } from "@depmap/graph";
import { cn } from "@/lib/utils";

/**
 * Confidence encoding — must match the map (docs/UI.md §2):
 * confirmed = solid, detected = dashed, inferred = dotted + muted.
 */
const STYLES: Record<Confidence, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "border-solid border-foreground/40 text-foreground" },
  detected: { label: "Detected", className: "border-dashed border-accent/70 text-accent" },
  inferred: { label: "Inferred", className: "border-dotted border-muted text-muted" },
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const s = STYLES[confidence];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded border px-1.5 text-[11px] leading-none font-medium",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}
