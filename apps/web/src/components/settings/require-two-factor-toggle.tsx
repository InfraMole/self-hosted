// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

export function RequireTwoFactorToggle({
  value,
  editable,
  action,
}: {
  value: boolean;
  editable: boolean;
  action: (value: boolean) => Promise<{ error?: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value}
          disabled={!editable || pending}
          onChange={(e) => {
            const next = e.target.checked;
            startTransition(async () => {
              const result = await action(next);
              setError(result.error ?? null);
            });
          }}
          className="accent-[var(--accent)]"
          aria-describedby="require-2fa-help"
        />
        Require two-factor authentication for every member
      </label>
      <p id="require-2fa-help" className="text-subtle text-xs">
        Members without an authenticator app are asked to set one up before they can open this
        workspace.{!editable && " Only owners can change this."}
      </p>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}{" "}
          {error.includes("your own account") && (
            <Link href="/account" className="underline">
              Set it up
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
