// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export type SsoProviderName = "google" | "microsoft";

export const SSO_LABELS: Record<SsoProviderName, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

/** "Continue with …" buttons; rendered only for providers the server enabled. */
export function SsoButtons({
  providers,
  next,
  mode,
}: {
  providers: SsoProviderName[];
  next: string | null;
  mode: "sign-in" | "sign-up";
}) {
  const [pending, setPending] = useState<SsoProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (providers.length === 0) return null;

  async function go(provider: SsoProviderName) {
    setPending(provider);
    setError(null);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: next ?? "/",
      newUserCallbackURL: next ?? "/onboarding",
      errorCallbackURL: mode === "sign-in" ? "/sign-in" : "/sign-up",
    });
    // On success the browser is redirected to the provider.
    if (error) {
      setError(error.message || "Could not start the sign-in.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((p) => (
        <Button
          key={p}
          type="button"
          variant="secondary"
          disabled={pending !== null}
          onClick={() => go(p)}
        >
          {pending === p ? "Redirecting…" : `Continue with ${SSO_LABELS[p]}`}
        </Button>
      ))}
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <div className="text-subtle my-1 flex items-center gap-3 text-[11px]">
        <span className="bg-border h-px flex-1" />
        or with email
        <span className="bg-border h-px flex-1" />
      </div>
    </div>
  );
}
