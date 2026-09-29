// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Calls a server action that redirects to Stripe; shows its error otherwise. */
export function RedirectButton({
  label,
  pendingLabel,
  action,
  variant = "default",
}: {
  label: string;
  pendingLabel: string;
  action: () => Promise<{ error?: string }>;
  variant?: "default" | "secondary";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action();
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? pendingLabel : label}
      </Button>
      {error && (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
