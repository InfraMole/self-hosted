// SPDX-License-Identifier: AGPL-3.0-only
import { DocsShell } from "@/components/docs/docs-shell";

export default function DocsLayoutEs({ children }: LayoutProps<"/es/docs">) {
  return <DocsShell locale="es">{children}</DocsShell>;
}
