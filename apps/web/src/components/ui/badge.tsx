// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "border-border-strong text-muted inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
