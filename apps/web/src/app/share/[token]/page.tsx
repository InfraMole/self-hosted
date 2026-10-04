// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { SharedMap } from "@/components/map/shared-map";
import { ipFromHeaders } from "@/server/http";
import { resolveShare } from "@/server/modules/map/shares";
import { rateLimit } from "@/server/rate-limit";

// The token is in the URL: never indexed, never sent on as a referrer.
export const metadata: Metadata = {
  title: "Shared map",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/** Public read-only link to a saved view (M31, ADR-045). No account needed. */
export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const ip = ipFromHeaders(await headers());
  if (!rateLimit(`share:${ip}`, 120, 60_000).allowed)
    return (
      <p className="text-muted m-auto p-6 text-sm">Too many requests. Try again in a minute.</p>
    );
  const shared = await resolveShare(token);
  if (!shared) notFound();

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5">
        <Link href="/" aria-label="InfraMole">
          <Logo className="h-6" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{shared.viewName}</h1>
          <p className="text-muted truncate text-xs">
            {shared.workspaceName} · read-only map, shared with a link
          </p>
        </div>
        <p className="text-subtle ml-auto hidden text-xs sm:block">
          Lines show what depends on what; dashed lines are not confirmed.
        </p>
      </header>
      <main className="min-h-0 flex-1">
        {shared.nodes.length === 0 ? (
          <p className="text-muted p-6 text-sm">This view shows no resources right now.</p>
        ) : (
          <SharedMap
            viewName={shared.viewName}
            workspaceName={shared.workspaceName}
            nodes={shared.nodes}
            edges={shared.edges}
            state={shared.state}
          />
        )}
      </main>
    </div>
  );
}
