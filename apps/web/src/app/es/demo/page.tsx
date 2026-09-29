// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { DemoPage } from "@/components/site/demo-page";
import { languageAlternates } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Demo en vivo",
  description: "Explora InfraMole con una infraestructura de ejemplo — solo lectura, sin registro.",
  alternates: languageAlternates("/demo"),
};
export const dynamic = "force-dynamic";

export default function DemoEs() {
  return <DemoPage locale="es" />;
}
