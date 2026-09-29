// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { ResendVerification } from "./resend-verification";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email.slice(0, 254) : "";
  const next = safeNext(params.next);
  return (
    <div className="flex flex-col gap-4 text-center">
      <h1 className="text-base font-medium">Check your inbox</h1>
      <p className="text-muted text-sm">
        We sent a link to {email ? <span className="text-foreground">{email}</span> : "your email"}.
        Open it to verify your address and continue. It expires in 1 hour.
      </p>
      {email && <ResendVerification email={email} callbackURL={next ?? "/"} />}
      <p className="text-muted mt-2 text-xs">
        <Link
          href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}
          className="text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
