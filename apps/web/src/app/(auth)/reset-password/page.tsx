// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

// The token is in the URL: never leak it through the Referer header.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && token.length < 256 && !error;
  return (
    <>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="text-muted text-center text-sm">
          This reset link is not valid or has expired.{" "}
          <Link
            href="/forgot-password"
            className="text-foreground underline-offset-4 hover:underline"
          >
            Request a new one
          </Link>
          .
        </p>
      )}
    </>
  );
}
