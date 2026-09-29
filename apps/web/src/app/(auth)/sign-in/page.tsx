// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { SsoButtons } from "@/components/auth/sso-buttons";
import { TermsNotice } from "@/components/legal/terms-notice";
import { safeNext } from "@/lib/safe-next";
import { enabledSsoProviders } from "@/server/auth";
import { getEnv } from "@/server/env";
import { SignInForm } from "./sign-in-form";

/** Better Auth OAuth error codes → honest, non-technical copy. */
function ssoErrorMessage(code: string): string {
  if (code === "account_not_linked")
    return "An account with this email already exists. Sign in with your password, then connect it from Account & security.";
  if (code === "email_not_found") return "The provider did not share an email address.";
  return "Sign-in with the provider did not complete. Try again.";
}

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const ssoError = typeof sp.error === "string" ? ssoErrorMessage(sp.error) : null;
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  const providers = enabledSsoProviders();
  return (
    <>
      {sp.deleted === "1" && (
        <p role="status" className="text-muted mb-4 text-center text-xs">
          Your account was deleted.
        </p>
      )}
      {ssoError && (
        <p role="alert" className="text-danger mb-4 text-center text-xs">
          {ssoError}
        </p>
      )}
      <SsoButtons providers={providers} next={next} mode="sign-in" />
      <SignInForm next={next} />
      {/* A first Google/Microsoft sign-in creates the account (Cloud: accepts the Terms). */}
      {getEnv().EDITION === "cloud" && providers.length > 0 && (
        <TermsNotice action="continuing with a new Google or Microsoft account" />
      )}
      {getEnv().SIGNUP === "open" && (
        <p className="text-muted mt-6 text-center text-xs">
          No account?{" "}
          <Link
            href={`/sign-up${suffix}`}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      )}
    </>
  );
}
