// SPDX-License-Identifier: AGPL-3.0-only
import { LegalShell } from "@/components/site/legal-shell";

export default function LegalLayoutEs({ children }: LayoutProps<"/es/legal">) {
  return <LegalShell locale="es">{children}</LegalShell>;
}
