// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

export function DepthSelect({ value, max }: { value: number; max: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="text-muted flex items-center gap-2 text-xs">
      Max depth
      <Select
        aria-label="Max depth"
        value={String(value)}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (Number(e.target.value) === max) next.delete("depth");
          else next.set("depth", e.target.value);
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }}
        className="w-28"
      >
        {[1, 2, 3, 5].map((d) => (
          <option key={d} value={d}>
            {d} hop{d === 1 ? "" : "s"}
          </option>
        ))}
        <option value={max}>All ({max})</option>
      </Select>
    </label>
  );
}
