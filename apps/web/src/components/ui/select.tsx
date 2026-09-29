// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native <select> styled with our tokens (accessible, no JS). */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className="border-border-strong bg-surface text-foreground focus-visible:border-accent focus-visible:ring-ring/30 aria-invalid:border-danger h-8 w-full appearance-none rounded-md border pr-7 pl-2.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="text-subtle pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2" />
    </div>
  );
}
