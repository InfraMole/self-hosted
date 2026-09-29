// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";

// Mirrors PASSWORD_MIN_LENGTH in src/server/auth.ts (server is authoritative).
const PASSWORD_MIN_LENGTH = 10;

export function SignUpForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const email = String(form.get("email") ?? "");
    const { data, error } = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim(),
      email,
      password: String(form.get("password") ?? ""),
      // Where the verification link lands (after signing the user in).
      callbackURL: next ?? "/",
    });
    if (error) {
      setError(authErrorMessage(error, "Could not create the account."));
      setPending(false);
      return;
    }
    if (!data?.token) {
      // Email verification required: no session until the link is opened.
      const q = new URLSearchParams({ email, ...(next ? { next } : {}) });
      router.replace(`/verify-email?${q}`);
      return;
    }
    router.replace(next ?? "/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" autoComplete="name" required maxLength={64} autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
        />
        <p className="text-subtle text-[11px]">At least {PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
