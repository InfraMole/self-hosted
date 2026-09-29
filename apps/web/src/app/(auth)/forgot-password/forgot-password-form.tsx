// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // Same answer whether or not the account exists (no enumeration).
    if (error && error.status === 429) setError(authErrorMessage(error, ""));
    else setSent(true);
  }

  if (sent)
    return (
      <p role="status" className="text-muted text-center text-sm">
        If an account exists for that address, we sent a link to reset the password. It expires in 1
        hour.
      </p>
    );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-muted text-sm">
        Enter your email and we will send you a link to choose a new password.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
