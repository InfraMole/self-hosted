// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";

export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      callbackURL: next ?? "/",
    });
    if (error) {
      setError(authErrorMessage(error, "Could not sign in."));
      setPending(false);
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.replace(next ? `/two-factor?next=${encodeURIComponent(next)}` : "/two-factor");
      return;
    }
    router.replace(next ?? "/");
    router.refresh();
  }

  async function signInWithPasskey() {
    setError(null);
    setPending(true);
    const { error } = await authClient.signIn.passkey();
    if (error) {
      setError(error.message || "Passkey sign-in was cancelled or failed.");
      setPending(false);
      return;
    }
    router.replace(next ?? "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-subtle hover:text-foreground text-[11px]">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={signInWithPasskey}>
        <KeyRound /> Sign in with a passkey
      </Button>
    </form>
  );
}
