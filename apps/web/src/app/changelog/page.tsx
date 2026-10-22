// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { ChangelogPage } from "@/components/site/changelog-page";
import { CHANGELOG_FEED_PATH } from "@/lib/changelog";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "What's new",
  description: "Every release of the InfraMole server and agent, newest first.",
  alternates: {
    ...languageAlternates("/changelog"),
    types: { "application/atom+xml": CHANGELOG_FEED_PATH },
  },
};

// Built from CHANGELOG.md at build time: an installation shows its own notes.
export const dynamic = "force-static";

export default function Changelog() {
  return <ChangelogPage locale="en" />;
}
