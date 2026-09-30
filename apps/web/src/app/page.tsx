// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { HomePage } from "@/components/landing/home-page";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: { absolute: "InfraMole — See what depends on what" },
  openGraph: {
    title: "InfraMole — See what depends on what",
    url: "/",
  },
  alternates: languageAlternates("/"),
};

export default function Home() {
  return <HomePage locale="en" />;
}
