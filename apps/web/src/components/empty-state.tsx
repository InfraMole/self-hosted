// SPDX-License-Identifier: AGPL-3.0-only
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  hint,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border-strong flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      <div className="border-border-strong bg-surface-2 text-muted mb-4 flex size-9 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-muted mt-1 max-w-md text-sm">{description}</p>
      {children && <div className="mt-5 flex items-center gap-2">{children}</div>}
      {hint && (
        <p className="text-subtle mt-6 font-mono text-[11px] tracking-wide uppercase">{hint}</p>
      )}
    </div>
  );
}
