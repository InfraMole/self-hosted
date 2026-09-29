// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { Mascot } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <Mascot className="h-auto w-40 opacity-90" />
      <h1 className="text-sm font-medium">Not found</h1>
      <p className="text-muted text-sm">
        This page does not exist, or you do not have access to it.
      </p>
      <Link href="/" className="text-accent mt-2 text-xs hover:underline">
        Back to InfraMole
      </Link>
    </main>
  );
}
