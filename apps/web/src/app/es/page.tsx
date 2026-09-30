// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { HomePage } from "@/components/landing/home-page";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: { absolute: "InfraMole — Descubre qué depende de qué" },
  description:
    "Un mapa vivo y sencillo de tu infraestructura — para equipos de IT pequeños, MSP y homelabs.",
  alternates: languageAlternates("/"),
  openGraph: {
    title: "InfraMole — Descubre qué depende de qué",
    description:
      "Un mapa vivo y sencillo de tu infraestructura — para equipos de IT pequeños, MSP y homelabs.",
    locale: "es_ES",
    url: "/es",
  },
};

export default function HomeEs() {
  return <HomePage locale="es" />;
}
