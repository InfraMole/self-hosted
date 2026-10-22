// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

/** Private demo (M35): back to the example data, now. */
export function ResetDemoButton({
  reset,
}: {
  reset: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-danger">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Reset the demo? Every change made in it is discarded.")) return;
          startTransition(async () => {
            const res = await reset();
            if (!res.ok) setError(res.error ?? "Could not reset.");
            else router.push("/w/demo/library");
          });
        }}
        className="text-accent inline-flex shrink-0 items-center gap-1 font-medium underline-offset-4 hover:underline disabled:opacity-50"
      >
        <RotateCcw className="size-3" /> {pending ? "Resetting…" : "Reset demo"}
      </button>
    </span>
  );
}
