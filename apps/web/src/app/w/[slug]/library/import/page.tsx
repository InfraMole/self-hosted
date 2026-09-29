// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ImportForm } from "@/components/importers/import-form";
import { PageHeader } from "@/components/page-header";
import { hasRole } from "@/server/authz";
import { requireWorkspace } from "@/server/tenancy";
import { applyImportAction, previewImportAction } from "./actions";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ params }: PageProps<"/w/[slug]/library/import">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);

  return (
    <>
      <PageHeader
        title="Import"
        description="Bring an existing inventory: CSV, JSON or a docker-compose file. Preview first — nothing is written until you import."
      />
      <div className="flex-1 p-6">
        <nav className="text-subtle mb-4 flex items-center gap-1 text-xs" aria-label="Breadcrumb">
          <Link href={`/w/${ctx.workspaceSlug}/library`} className="hover:text-foreground">
            Library
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-muted">Import</span>
        </nav>
        {hasRole(ctx.role, "MEMBER") ? (
          <ImportForm
            slug={ctx.workspaceSlug}
            preview={previewImportAction.bind(null, ctx.workspaceSlug)}
            apply={applyImportAction.bind(null, ctx.workspaceSlug)}
          />
        ) : (
          <p className="text-muted text-sm">Only members with write access can import.</p>
        )}
      </div>
    </>
  );
}
