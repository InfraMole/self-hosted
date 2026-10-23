// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { cn } from "@/lib/utils";

/** "Last report incomplete" note (M39): what the agent could not collect. */
export function ReportGaps({ gaps, className }: { gaps: string[]; className?: string }) {
  return (
    <div className={cn("mt-1 text-[11px]", className)}>
      <p className="text-warning">Last report incomplete</p>
      {gaps.map((line) => (
        <p key={line} className="text-subtle">
          {line}
        </p>
      ))}
      <Link
        href="/docs/agent/manage#incomplete-reports"
        className="text-subtle hover:text-foreground underline underline-offset-4"
      >
        Why this happens
      </Link>
    </div>
  );
}
