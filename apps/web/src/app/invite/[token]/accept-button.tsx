// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function AcceptButton({ action }: { action: () => Promise<{ error?: string }> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action();
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
