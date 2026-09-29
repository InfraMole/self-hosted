// SPDX-License-Identifier: AGPL-3.0-only
import { usageLevel, type Usage } from "@/lib/billing-plans";
import { cn } from "@/lib/utils";

const TONE = { ok: "bg-accent", near: "bg-warning", at: "bg-warning", over: "bg-danger" } as const;

export function UsageMeter({ usage }: { usage: Usage }) {
  const level = usageLevel(usage);
  const pct =
    usage.limit === null ? 0 : Math.min(100, Math.round((usage.nodes / usage.limit) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>
          <span className="font-mono">{usage.nodes}</span>
          {usage.limit !== null && (
            <span className="text-muted">
              {" "}
              of <span className="font-mono">{usage.limit}</span>
            </span>
          )}{" "}
          servers and VMs
          <span className="text-subtle text-xs">
            {" "}
            · {usage.scope === "instance" ? "whole installation" : "this workspace"}
          </span>
        </span>
        {usage.limit === null && <span className="text-subtle text-xs">no limit</span>}
      </div>
      {usage.limit !== null && (
        <div className="bg-surface-2 h-1.5 overflow-hidden rounded-full" aria-hidden>
          <div className={cn("h-full rounded-full", TONE[level])} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-subtle text-xs">
        Only servers and VMs count. Applications, databases, domains, containers and everything else
        are free and unlimited.
      </p>
    </div>
  );
}
