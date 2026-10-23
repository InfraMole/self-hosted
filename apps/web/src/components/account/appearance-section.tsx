// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "Match system", icon: Monitor },
];

/** Theme for this browser (ADR-054): kept locally, not on the account. */
export function AppearanceSection() {
  const preference = useThemePreference();
  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Saved in this browser only. The sun and moon button in the sidebar switches it too.
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Theme">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            onClick={() => setThemePreference(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
              preference === value
                ? "border-accent/60 bg-accent/10 text-foreground"
                : "border-border text-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
