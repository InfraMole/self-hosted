// SPDX-License-Identifier: AGPL-3.0-only
import { LegalShell } from "@/components/site/legal-shell";

export default function LegalLayout({ children }: LayoutProps<"/legal">) {
  return <LegalShell locale="en">{children}</LegalShell>;
}
