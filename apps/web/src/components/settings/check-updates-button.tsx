// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Settings › Workspace (M36): ask for the latest releases now, not tomorrow. */
export function CheckUpdatesButton({ check }: { check: () => Promise<{ error?: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await check();
            setError(res.error ?? null);
            router.refresh();
          })
        }
        className="text-accent inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline disabled:opacity-50"
      >
        <RefreshCw className={pending ? "size-3 animate-spin" : "size-3"} />
        {pending ? "Checking…" : "Check now"}
      </button>
      {error && <span className="text-danger text-xs">{error}</span>}
    </span>
  );
}
