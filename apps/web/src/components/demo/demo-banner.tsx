// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";

/** Shown on every workspace page to the shared demo account (M13). */
export function DemoBanner() {
  return (
    <div
      role="status"
      className="border-accent/30 bg-accent/10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-6 py-1.5 text-xs"
    >
      <span>
        <span className="text-accent font-medium">Live demo</span> — example data, read-only,
        rebuilt every day. Try <span className="font-medium">Map › SQL01 › Impact</span>.
      </span>
      <Link
        href="/docs/installation/requirements"
        className="text-accent shrink-0 font-medium underline-offset-4 hover:underline"
      >
        Install it free →
      </Link>
    </div>
  );
}
