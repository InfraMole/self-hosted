// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { SsoButtons } from "@/components/auth/sso-buttons";
import { TermsNotice } from "@/components/legal/terms-notice";
import { safeNext } from "@/lib/safe-next";
import { enabledSsoProviders } from "@/server/auth";
import { getEnv } from "@/server/env";
import { signUpFormAvailable } from "@/server/modules/access/signup";
import { SignUpForm } from "./sign-up-form";

/** Better Auth OAuth error codes → honest, non-technical copy. */
function ssoErrorMessage(code: string): string {
  if (code === "account_not_linked")
    return "An account with this email already exists. Sign in with your password, then connect it from Account & security.";
  if (code === "email_not_found") return "The provider did not share an email address.";
  return "Sign-in with the provider did not complete. Try again.";
}

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const ssoError = typeof sp.error === "string" ? ssoErrorMessage(sp.error) : null;
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  if (!(await signUpFormAvailable(next)))
    return (
      <div className="text-center">
        <p className="text-sm font-medium">Registration is closed on this server.</p>
        <p className="text-muted mt-2 text-sm">
          Ask an administrator of this InfraMole installation for an invitation — the link in it
          lets you create your account.
        </p>
        <p className="text-muted mt-6 text-xs">
          Already have an account?{" "}
          <Link
            href={`/sign-in${suffix}`}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  return (
    <>
      {ssoError && (
        <p role="alert" className="text-danger mb-4 text-center text-xs">
          {ssoError}
        </p>
      )}
      <SsoButtons providers={enabledSsoProviders()} next={next} mode="sign-up" />
      <SignUpForm next={next} />
      {getEnv().EDITION === "cloud" && <TermsNotice action="creating an account" />}
      <p className="text-muted mt-6 text-center text-xs">
        Already have an account?{" "}
        <Link
          href={`/sign-in${suffix}`}
          className="text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
