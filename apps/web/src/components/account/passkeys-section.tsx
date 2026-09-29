// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";

export function PasskeysSection({
  passkeys,
  onAdded,
  onRemove,
}: {
  passkeys: { id: string; name: string | null; createdAt: Date | null }[];
  onAdded: () => Promise<void>;
  onRemove: (id: string) => Promise<{ error?: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      setError(null);
      const { error } = await authClient.passkey.addPasskey({ name: name.trim() || "Passkey" });
      if (error) {
        setError(error.message || "The passkey was not added (cancelled or not supported).");
        return;
      }
      await onAdded();
      setName("");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <p className="text-muted text-xs">
        Sign in with your device (Touch ID, Windows Hello, a security key) instead of a password.
        Phishing-resistant. The private key never leaves your device.
      </p>
      {passkeys.length > 0 && (
        <ul className="divide-border border-border divide-y rounded-md border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <KeyRound className="text-subtle size-4" />
              <span className="flex-1">{p.name ?? "Passkey"}</span>
              {p.createdAt && (
                <span className="text-subtle text-xs">added {formatDateTime(p.createdAt)}</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await onRemove(p.id);
                    setError(result.error ?? null);
                  })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          aria-label="Passkey name"
          placeholder="e.g. MacBook, YubiKey"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          className="max-w-60"
        />
        <Button size="sm" variant="secondary" disabled={pending} onClick={add}>
          Add a passkey
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
