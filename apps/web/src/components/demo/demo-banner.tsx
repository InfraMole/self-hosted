// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { ResetDemoButton } from "./reset-demo-button";

/**
 * Shown on every workspace page to the demo account (M13). A private,
 * writable demo (M35) says that changes are discarded and offers a reset.
 */
export function DemoBanner({
  reset,
  resetHours,
}: {
  /** Set for a writable private demo. */
  reset?: () => Promise<{ ok: boolean; error?: string }>;
  resetHours: number;
}) {
  const every =
    resetHours % 24
      ? `every ${resetHours} h`
      : resetHours === 24
        ? "every day"
        : `every ${resetHours / 24} days`;
  return (
    <div
      role="status"
      className="border-accent/30 bg-accent/10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-6 py-1.5 text-xs"
    >
      {reset ? (
        <>
          <span>
            <span className="text-accent font-medium">Private demo</span> — example data you can
            change. Changes are discarded when the demo is reset ({every}).
          </span>
          <ResetDemoButton reset={reset} />
        </>
      ) : (
        <>
          <span>
            <span className="text-accent font-medium">Live demo</span> — example data, read-only,
            rebuilt {every}. Try <span className="font-medium">Map › SQL01 › Impact</span>.
          </span>
          <Link
            href="/docs/installation/requirements"
            className="text-accent shrink-0 font-medium underline-offset-4 hover:underline"
          >
            Install it free →
          </Link>
        </>
      )}
    </div>
  );
}
