// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven segmented control (filters live in the query string). */
export function Segmented({
  items,
}: {
  items: { label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="border-border-strong flex rounded-md border p-0.5">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          aria-current={i.active ? "true" : undefined}
          className={cn(
            "rounded px-2.5 py-1 text-xs",
            i.active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
