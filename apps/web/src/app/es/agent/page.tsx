// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { AgentPage } from "@/components/site/agent-page";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Qué recoge el agente",
  description:
    "Exactamente qué envía el agente de solo lectura de InfraMole, para qué, y qué no recoge nunca.",
  alternates: languageAlternates("/agent"),
};

export const dynamic = "force-static";

export default function AgentEs() {
  return <AgentPage locale="es" />;
}
