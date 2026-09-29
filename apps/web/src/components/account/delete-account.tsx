// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.deleteUser(
      hasPassword ? { password: String(form.get("password") ?? "") } : {},
    );
    if (error) {
      setError(
        error.status === 400 && /password/i.test(error.message ?? "")
          ? "Wrong password."
          : error.message || "Could not delete the account.",
      );
      setPending(false);
      return;
    }
    router.replace("/sign-in?deleted=1");
    router.refresh();
  }

  if (!open)
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted text-xs">
          Deletes your account and every workspace where you are the only member. You leave shared
          workspaces; if you are their only owner, make someone else owner first.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {hasPassword ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delete-password">Confirm with your password</Label>
          <Input
            id="delete-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </div>
      ) : (
        <p className="text-muted text-xs">
          You signed in recently with SSO; no password is needed.
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Delete my account permanently"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
