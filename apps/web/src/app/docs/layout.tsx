// SPDX-License-Identifier: AGPL-3.0-only
import { DocsShell } from "@/components/docs/docs-shell";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return <DocsShell locale="en">{children}</DocsShell>;
}
