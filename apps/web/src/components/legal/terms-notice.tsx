// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";

/** Cloud sign-up / SSO: creating an account accepts the Terms (recorded by server/auth.ts). */
export function TermsNotice({ action }: { action: string }) {
  return (
    <p className="text-subtle mt-4 text-center text-xs leading-relaxed">
      By {action} you agree to the{" "}
      <Link href="/legal/terms" className="text-muted underline underline-offset-2">
        Terms of Service
      </Link>{" "}
      and acknowledge the{" "}
      <Link href="/legal/privacy" className="text-muted underline underline-offset-2">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
