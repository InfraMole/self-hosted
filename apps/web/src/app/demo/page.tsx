// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { DemoPage } from "@/components/site/demo-page";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Live demo",
  description: "Explore InfraMole with example infrastructure — read-only, no sign-up.",
  alternates: languageAlternates("/demo"),
};
export const dynamic = "force-dynamic";

export default function Demo() {
  return <DemoPage locale="en" />;
}
