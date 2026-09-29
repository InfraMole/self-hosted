// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";

export function TwoFactorForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    setPending(true);
    setError(null);
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    if (error) {
      setError(
        error.status === 401 || error.status === 400
          ? "That code is not valid. Try again."
          : authErrorMessage(error, "Could not verify the code."),
      );
      setPending(false);
      return;
    }
    router.replace(next ?? "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-muted text-sm">
        {backup
          ? "Enter one of your backup codes. Each code works once."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">{backup ? "Backup code" : "Code"}</Label>
        <Input
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={backup ? "text" : "numeric"}
          maxLength={backup ? 32 : 8}
          className="font-mono tracking-widest"
        />
      </div>
      <label className="text-muted flex items-center gap-2 text-xs">
        <input type="checkbox" name="trust" className="accent-[var(--accent)]" />
        Trust this device for 30 days
      </label>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
      <button
        type="button"
        className="text-subtle hover:text-foreground text-xs"
        onClick={() => {
          setBackup(!backup);
          setError(null);
        }}
      >
        {backup ? "Use the authenticator app instead" : "Lost your device? Use a backup code"}
      </button>
    </form>
  );
}
