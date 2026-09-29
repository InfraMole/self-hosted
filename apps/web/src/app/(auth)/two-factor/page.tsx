// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function TwoFactorPage({ searchParams }: PageProps<"/two-factor">) {
  const next = safeNext((await searchParams).next);
  return (
    <>
      <TwoFactorForm next={next} />
      <p className="text-muted mt-6 text-center text-xs">
        <Link href="/sign-in" className="text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
