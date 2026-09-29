// SPDX-License-Identifier: AGPL-3.0-only
import { HtmlLang } from "@/components/landing/language";

/** Spanish public website and documentation (M14, ADR-026). The app stays English. */
export default function SpanishLayout({ children }: LayoutProps<"/es">) {
  return (
    <>
      <HtmlLang lang="es" />
      {children}
    </>
  );
}
