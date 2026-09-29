// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";

// Mirrors PASSWORD_MIN_LENGTH in src/server/auth.ts (server is authoritative).
const PASSWORD_MIN_LENGTH = 10;

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) {
      setError(
        error.status === 400 && !/password/i.test(error.message ?? "")
          ? "This reset link is not valid or has expired. Request a new one."
          : authErrorMessage(error, "Could not reset the password."),
      );
      return;
    }
    setDone(true);
  }

  if (done)
    return (
      <p role="status" className="text-muted text-center text-sm">
        Password updated. Other sessions were signed out.{" "}
        <Link href="/sign-in" className="text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          autoFocus
        />
        <p className="text-subtle text-[11px]">At least {PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Repeat it</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          maxLength={128}
        />
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
