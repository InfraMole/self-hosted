// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ResourceTabs({ base }: { base: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/dependencies`, label: "Dependencies" },
    { href: `${base}/activity`, label: "Activity" },
  ];

  return (
    <nav className="mt-3 -mb-px flex gap-4" aria-label="Resource sections">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 pb-2.5 text-sm transition-colors",
              active
                ? "border-accent text-foreground"
                : "text-muted hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
