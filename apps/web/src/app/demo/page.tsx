// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { Mascot } from "@/components/logo";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_SLUG,
  demoEnabled,
  ensureDemo,
} from "@/server/modules/demo/demo";
import { DemoSignIn } from "./demo-sign-in";

export const metadata: Metadata = {
  title: "Live demo",
  description: "Explore InfraMole with example infrastructure — read-only, no sign-up.",
};
export const dynamic = "force-dynamic";

const tour = [
  { title: "Map", body: "Everything the example company runs, laid out by what depends on what." },
  {
    title: "Impact",
    body: "Pick SQL01 and ask what could be affected if it went down — with how certain each path is.",
  },
  {
    title: "Suggestions",
    body: "Connections an agent observed, waiting for a person to confirm them.",
  },
  { title: "Changes", body: "What changed, when and by whom." },
];

/** Public demo (M13): only when DEMO_MODE=true. */
export default async function DemoPage() {
  if (!demoEnabled()) notFound();
  await ensureDemo(); // first visit after a deploy or a reset builds it
  return (
    <div className="light flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-accent font-mono text-xs tracking-wide">live demo</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Explore InfraMole with example infrastructure
          </h1>
          <p className="text-muted mt-4 max-w-xl leading-relaxed">
            A fictional company with web servers, SQL Server, Active Directory, a Proxmox host and a
            few cloud services. Read-only, no sign-up — it is rebuilt every day.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            {tour.map((t) => (
              <li key={t.title}>
                <span className="font-semibold">{t.title}.</span>{" "}
                <span className="text-muted">{t.body}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <DemoSignIn email={DEMO_EMAIL} password={DEMO_PASSWORD} slug={DEMO_SLUG} />
          </div>
          <p className="text-subtle mt-6 text-xs">
            Like what you see?{" "}
            <Link href="/docs/installation/requirements" className="text-accent hover:underline">
              Install InfraMole Community for free
            </Link>{" "}
            — open source, unlimited servers and VMs.
          </p>
        </div>
        <Mascot priority className="mx-auto h-auto w-full max-w-sm" />
      </main>
      <SiteFooter />
    </div>
  );
}
