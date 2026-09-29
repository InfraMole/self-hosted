// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <ForgotPasswordForm />
      <p className="text-muted mt-6 text-center text-xs">
        <Link href="/sign-in" className="text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
