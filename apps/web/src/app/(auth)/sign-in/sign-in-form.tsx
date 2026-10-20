// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Building2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "../auth-error";
import { ssoRouteAction } from "./actions";

const SSO_ONLY = "single sign-on";

export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // "Sign in with SSO" (M33): email first, then the organization's provider.
  const [ssoMode, setSsoMode] = useState(false);
  // LDAP / Active Directory: the directory password is asked here.
  const [directory, setDirectory] = useState<string | null>(null);

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
      const message = authErrorMessage(error, "Could not sign in.");
      // An SSO-only domain: switch to the single sign-on form with the email kept.
      if (message.toLowerCase().includes(SSO_ONLY)) setSsoMode(true);
      setError(message);
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

  async function signInWithSso(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    setPending(true);
    setError(null);
    if (directory) {
      const { error } = await authClient.$fetch("/sso/ldap/sign-in", {
        method: "POST",
        body: { email, password: String(form.get("password") ?? "") },
      });
      if (error) {
        setError(authErrorMessage(error, "Could not sign in."));
        setPending(false);
        return;
      }
      router.replace(next ?? "/");
      router.refresh();
      return;
    }
    const route = await ssoRouteAction(email);
    if (!route.ok) {
      setError(route.error);
      setPending(false);
      return;
    }
    if (route.protocol === "LDAP") {
      setDirectory(route.name);
      setPending(false);
      return;
    }
    const { error } = await authClient.signIn.sso({
      providerId: route.providerId,
      callbackURL: next ?? "/",
      errorCallbackURL: next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in",
    });
    if (error) {
      setError(authErrorMessage(error, "Single sign-on could not start."));
      setPending(false);
    }
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

  if (ssoMode)
    return (
      <form onSubmit={signInWithSso} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sso-email">Work email</Label>
          <Input
            id="sso-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@your-organization.example"
            required
            autoFocus
            readOnly={directory !== null}
          />
        </div>
        {directory && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sso-password">Password</Label>
            <Input
              id="sso-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
            <p className="text-subtle text-xs">Your {directory} directory password.</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {directory
            ? pending
              ? "Signing in…"
              : "Sign in"
            : pending
              ? "Redirecting…"
              : "Continue with single sign-on"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setSsoMode(false);
            setDirectory(null);
            setError(null);
          }}
        >
          Back to password sign-in
        </Button>
      </form>
    );

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
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setSsoMode(true);
          setError(null);
        }}
      >
        <Building2 /> Sign in with SSO
      </Button>
    </form>
  );
}
