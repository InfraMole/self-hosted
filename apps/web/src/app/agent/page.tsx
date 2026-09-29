// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { AgentPage } from "@/components/site/agent-page";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "What the agent collects",
  description:
    "Exactly what the read-only InfraMole agent reports, why, and what it never collects.",
  alternates: languageAlternates("/agent"),
};

// Public, identical for every edition: honesty about data collection (docs/AGENT.md §3).
export const dynamic = "force-static";

export default function Agent() {
  return <AgentPage locale="en" />;
}
