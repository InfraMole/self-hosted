// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { ChevronRight, Network, Pencil, Radar } from "lucide-react";
import { toFormValues } from "@/components/resources/form-values";
import { DeleteResourceButton } from "@/components/resources/delete-resource-button";
import {
  EnvironmentLabel,
  StatusBadge,
  TechLabel,
  TypeIcon,
} from "@/components/resources/resource-badges";
import { resolveTech } from "@/lib/tech";
import { ResourceSheet } from "@/components/resources/resource-sheet";
import { ResourceTabs } from "@/components/resources/resource-tabs";
import { Button } from "@/components/ui/button";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { hasRole } from "@/server/authz";
import { deleteResourceAction, saveResourceAction } from "../actions";
import { loadResource } from "./data";

export default async function ResourceLayout({
  children,
  params,
}: LayoutProps<"/w/[slug]/resources/[id]">) {
  const { slug, id } = await params;
  const { ctx, resource } = await loadResource(slug, id);
  const canWrite = hasRole(ctx.role, "MEMBER");
  const base = `/w/${ctx.workspaceSlug}/resources/${resource.id}`;

  return (
    <>
      <header className="border-border shrink-0 border-b px-6 pt-3">
        <nav className="text-subtle flex items-center gap-1 text-xs" aria-label="Breadcrumb">
          <Link href={`/w/${ctx.workspaceSlug}/library`} className="hover:text-foreground">
            Library
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-muted">{RESOURCE_TYPES[resource.type].label}</span>
        </nav>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="border-border-strong bg-surface-2 flex size-9 shrink-0 items-center justify-center rounded-md border">
              <TypeIcon type={resource.type} className="text-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-mono text-base font-medium">{resource.name}</h1>
              <div className="text-muted mt-0.5 flex items-center gap-3 text-xs">
                <EnvironmentLabel environment={resource.environment} />
                <StatusBadge status={resource.status} />
                <TechLabel tech={resolveTech(resource.tags, resource.metadata.os)} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${base}/impact`}>
                <Radar /> Impact
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/w/${ctx.workspaceSlug}/map?focus=${resource.id}`}>
                <Network /> Map
              </Link>
            </Button>
            {canWrite && (
              <>
                <ResourceSheet
                  mode="edit"
                  workspaceSlug={ctx.workspaceSlug}
                  initial={toFormValues(resource)}
                  action={saveResourceAction.bind(null, ctx.workspaceSlug, resource.id)}
                  trigger={
                    <Button variant="secondary" size="sm">
                      <Pencil /> Edit
                    </Button>
                  }
                />
                <DeleteResourceButton
                  name={resource.name}
                  action={deleteResourceAction.bind(null, ctx.workspaceSlug, resource.id)}
                />
              </>
            )}
          </div>
        </div>
        <ResourceTabs base={base} />
      </header>
      <div className="flex-1 p-6">{children}</div>
    </>
  );
}
