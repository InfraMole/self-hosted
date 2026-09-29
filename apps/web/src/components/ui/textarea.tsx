// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "border-border-strong bg-surface text-foreground placeholder:text-subtle focus-visible:border-accent focus-visible:ring-ring/30 aria-invalid:border-danger min-h-16 w-full rounded-md border px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
