// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { Mascot } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Weekly summary", robots: { index: false } };

/**
 * Confirmation page for the weekly digest's unsubscribe link (M21). The
 * button POSTs to /api/digest/unsubscribe; a plain visit changes nothing.
 */
export default async function UnsubscribePage({ searchParams }: PageProps<"/digest/unsubscribe">) {
  const { m, t, done } = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Mascot className="h-auto w-40" />
      {done === "1" ? (
        <>
          <h1 className="text-xl font-semibold">
            You will not receive the weekly summary any more
          </h1>
          <p className="text-muted text-sm">
            You can turn it on again at any time in your account settings.
          </p>
        </>
      ) : done === "0" ? (
        <>
          <h1 className="text-xl font-semibold">This link is not valid</h1>
          <p className="text-muted text-sm">
            It may be old or incomplete. Sign in and turn the weekly summary off in your account
            settings.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Stop the weekly summary?</h1>
          <p className="text-muted text-sm">
            You will stop receiving the weekly email summary of changes for this workspace.
          </p>
          <form
            method="post"
            action={`/api/digest/unsubscribe?m=${encodeURIComponent(str(m))}&t=${encodeURIComponent(str(t))}`}
          >
            <Button type="submit">Unsubscribe</Button>
          </form>
        </>
      )}
      <Link href="/account" className="text-accent text-sm hover:underline">
        Account settings
      </Link>
    </main>
  );
}
