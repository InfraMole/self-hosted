// SPDX-License-Identifier: AGPL-3.0-only
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { DOCS_NAV } from "@/lib/docs-nav";
import { loadSearchIndex } from "@/server/docs";

/** Documentation portal (M12): light island, sidebar + search, content, on-page TOC. */
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const index = await loadSearchIndex();
  return (
    <div className="light flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 gap-8 px-4 sm:px-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-8 pr-2">
            <DocsSidebar nav={DOCS_NAV} index={index} />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <details className="border-border mt-6 rounded-md border px-3 py-2 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">Documentation menu</summary>
            <div className="py-3">
              <DocsSidebar nav={DOCS_NAV} index={index} />
            </div>
          </details>
          {children}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
