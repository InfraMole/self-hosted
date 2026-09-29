// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";
import Link from "next/link";
import { Mascot, Wordmark } from "@/components/logo";
import { getSession } from "@/server/tenancy";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getSession()) redirect("/");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[340px]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Link href="/" aria-label="InfraMole home" className="flex flex-col items-center gap-2">
            <Mascot priority className="h-auto w-28" />
            <Wordmark className="text-lg" />
          </Link>
          <p className="text-muted text-sm">See what depends on what.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
