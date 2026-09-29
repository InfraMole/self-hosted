// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { SSO_LABELS, type SsoProviderName } from "@/components/auth/sso-buttons";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";

const LABEL: Record<string, string> = { credential: "Email and password", ...SSO_LABELS };

export function SignInMethods({
  methods,
  available,
}: {
  methods: { providerId: string; createdAt: Date }[];
  available: SsoProviderName[];
}) {
  const [error, setError] = useState<string | null>(null);
  const linked = new Set(methods.map((m) => m.providerId));
  const connectable = available.filter((p) => !linked.has(p));

  return (
    <div className="space-y-3">
      <ul className="divide-border border-border divide-y rounded-md border">
        {methods.map((m) => (
          <li key={m.providerId} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{LABEL[m.providerId] ?? m.providerId}</span>
            <span className="text-subtle text-xs">since {formatDateTime(m.createdAt)}</span>
          </li>
        ))}
      </ul>
      {connectable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {connectable.map((p) => (
            <Button
              key={p}
              size="sm"
              variant="secondary"
              onClick={async () => {
                setError(null);
                const { error } = await authClient.linkSocial({
                  provider: p,
                  callbackURL: "/account",
                });
                if (error) setError(error.message || "Could not connect the account.");
              }}
            >
              Connect {SSO_LABELS[p]}
            </Button>
          ))}
        </div>
      )}
      <p className="text-subtle text-xs">
        Connected accounts must use the same email address as this account.
      </p>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
