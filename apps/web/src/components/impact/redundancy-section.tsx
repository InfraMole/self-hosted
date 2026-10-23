// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { Layers } from "lucide-react";
import { TypeIcon } from "@/components/resources/resource-badges";
import type { CoveredView, DegradedView } from "@/server/modules/impact/impact";

/**
 * M39 (ADR-057): redundancy groups that lose members, and what the remaining
 * members still cover. Redundancy is what the user declared, so the copy says
 * so — it is not verified capacity.
 */
export function RedundancySection({
  slug,
  covered,
  degraded,
}: {
  slug: string;
  covered: readonly CoveredView[];
  degraded: readonly DegradedView[];
}) {
  if (covered.length === 0 && degraded.length === 0) return null;
  const names = (nodes: DegradedView["up"]) => nodes.map((n) => n.name).join(", ");
  return (
    <section
      aria-label="Redundancy"
      className="border-border bg-surface rounded-lg border p-4 print:break-inside-avoid"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Layers className="text-muted size-4" /> Redundancy
      </h3>
      {degraded.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {degraded.map((g) => (
            <li key={g.groupName}>
              <span className="font-medium">{g.groupName}</span>
              <span className="text-muted"> loses redundancy: </span>
              <span className="font-mono text-xs">{names(g.down)}</span>
              <span className="text-muted"> down, still up: </span>
              <span className="font-mono text-xs">{names(g.up)}</span>
            </li>
          ))}
        </ul>
      )}
      {covered.length > 0 && (
        <>
          <p className="text-muted mt-3 text-xs">
            Covered by redundancy — would be affected, but the remaining members still serve them:
          </p>
          <ul className="border-border divide-border mt-2 divide-y rounded-lg border">
            {covered.map((c) => (
              <li key={c.resourceId} className="flex items-center gap-3 px-3 py-2">
                <Link
                  href={`/w/${slug}/resources/${c.resourceId}/impact`}
                  className="hover:text-accent flex w-48 shrink-0 items-center gap-2 font-mono text-[13px]"
                >
                  <TypeIcon type={c.resource.type} />
                  <span className="truncate">{c.resource.name}</span>
                </Link>
                <span
                  className="text-subtle min-w-0 flex-1 truncate font-mono text-xs"
                  title={c.pathNames.join(" → ")}
                >
                  still served by {c.groupName}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-subtle mt-3 text-xs leading-relaxed">
        Based on the redundancy groups set on resources: InfraMole does not check that the remaining
        members can carry the load.
      </p>
    </section>
  );
}
