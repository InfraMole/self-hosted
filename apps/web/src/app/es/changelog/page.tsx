// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { ChangelogPage } from "@/components/site/changelog-page";
import { CHANGELOG_FEED_PATH } from "@/lib/changelog";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Novedades",
  description: "Cada versión del servidor y del agente de InfraMole, la más reciente primero.",
  alternates: {
    ...languageAlternates("/changelog"),
    types: { "application/atom+xml": CHANGELOG_FEED_PATH },
  },
};

export const dynamic = "force-static";

export default function ChangelogEs() {
  return <ChangelogPage locale="es" />;
}
