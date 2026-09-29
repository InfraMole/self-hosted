// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { Network, Pencil, Plus } from "lucide-react";
import { RELATIONSHIP_TYPE_INFO, edgeConfidence, perspective, type Bucket } from "@depmap/graph";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { DeleteRelationshipButton } from "@/components/relationships/delete-relationship-button";
import { RelationshipSheet } from "@/components/relationships/relationship-sheet";
import { EnvironmentLabel, TypeIcon } from "@/components/resources/resource-badges";
import { Button } from "@/components/ui/button";
import { hasRole } from "@/server/authz";
import {
  listRelationshipsForResource,
  type RelationshipView,
  type ResourceRef,
} from "@/server/modules/relationships/relationships";
import { listResources } from "@/server/modules/resources/resources";
import {
  createRelationshipAction,
  deleteRelationshipAction,
  updateRelationshipAction,
} from "../../relationship-actions";
import { loadResource } from "../data";

export const metadata: Metadata = { title: "Dependencies" };

const SECTIONS: { bucket: Bucket; title: string; empty: string; hint: string }[] = [
  {
    bucket: "dependsOn",
    title: "Depends on",
    hint: "What this resource needs.",
    empty: "Nothing recorded. What does this need to work — a host, a database, a domain?",
  },
  {
    bucket: "usedBy",
    title: "Used by",
    hint: "What needs this resource. These could be affected if it fails.",
    empty: "Nothing recorded depends on this resource.",
  },
  {
    bucket: "related",
    title: "Related",
    hint: "Informational links (monitoring, backups). Not used for impact.",
    empty: "No informational links.",
  },
];

interface Row {
  rel: RelationshipView;
  other: ResourceRef;
  phrase: string;
}

export default async function DependenciesPage({
  params,
}: PageProps<"/w/[slug]/resources/[id]/dependencies">) {
  const { slug, id } = await params;
  const { ctx, resource } = await loadResource(slug, id);
  const canWrite = hasRole(ctx.role, "MEMBER");
  const relationships = await listRelationshipsForResource(ctx, resource.id);

  const buckets: Record<Bucket, Row[]> = { dependsOn: [], usedBy: [], related: [] };
  for (const rel of relationships) {
    if (rel.status === "IGNORED") continue;
    const p = perspective(
      { id: rel.id, from: rel.from.id, to: rel.to.id, type: rel.type },
      resource.id,
    );
    const other = rel.from.id === resource.id ? rel.to : rel.from;
    buckets[p.bucket].push({ rel, other, phrase: p.phrase });
  }

  const candidates = canWrite
    ? (await listResources(ctx))
        .filter((r) => r.id !== resource.id)
        .map((r) => ({ id: r.id, name: r.name, type: r.type }))
    : [];
  const viewer = { id: resource.id, name: resource.name };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted text-sm">
          {relationships.length === 0
            ? "No relationships yet."
            : `${relationships.length} relationship${relationships.length === 1 ? "" : "s"}.`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/w/${ctx.workspaceSlug}/map?focus=${resource.id}`}>
              <Network /> Show on map
            </Link>
          </Button>
          {canWrite && (
            <RelationshipSheet
              mode="create"
              viewer={viewer}
              candidates={candidates}
              action={createRelationshipAction.bind(null, ctx.workspaceSlug, resource.id)}
              trigger={
                <Button size="sm">
                  <Plus /> Add relationship
                </Button>
              }
            />
          )}
        </div>
      </div>

      {SECTIONS.map((section) => {
        const rows = buckets[section.bucket];
        return (
          <section key={section.bucket}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-medium">{section.title}</h2>
              <span className="text-subtle font-mono text-xs">{rows.length}</span>
              <span className="text-subtle text-xs">— {section.hint}</span>
            </div>
            {rows.length === 0 ? (
              <p className="border-border text-subtle rounded-lg border border-dashed px-4 py-3 text-sm">
                {section.empty}
              </p>
            ) : (
              <ul className="border-border divide-border divide-y rounded-lg border">
                {rows.map(({ rel, other, phrase }) => {
                  const confidence = edgeConfidence(rel.status, rel.origin)!;
                  // Always read in stored direction: "<from> <label> <to>".
                  const readable = `${rel.from.name} ${RELATIONSHIP_TYPE_INFO[rel.type].label} ${rel.to.name}`;
                  return (
                    <li key={rel.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-muted w-40 shrink-0 truncate text-xs">{phrase}</span>
                      <Link
                        href={`/w/${ctx.workspaceSlug}/resources/${other.id}/dependencies`}
                        className="hover:text-accent flex min-w-0 items-center gap-2 font-mono text-[13px]"
                      >
                        <TypeIcon type={other.type} />
                        <span className="truncate">{other.name}</span>
                      </Link>
                      <span className="text-muted hidden text-xs sm:inline">
                        <EnvironmentLabel environment={other.environment} />
                      </span>
                      {rel.note && (
                        <span
                          className="text-subtle min-w-0 flex-1 truncate text-xs"
                          title={rel.note}
                        >
                          {rel.note}
                        </span>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {rel.status === "UNCONFIRMED" && (
                          <Link
                            href={`/w/${ctx.workspaceSlug}/suggestions#${rel.id}`}
                            className="text-accent text-xs hover:underline"
                          >
                            Review
                          </Link>
                        )}
                        <ConfidenceBadge confidence={confidence} />
                        {canWrite && (
                          <>
                            <RelationshipSheet
                              mode="edit"
                              viewer={viewer}
                              fixed={{
                                other: { id: other.id, name: other.name, type: other.type },
                                direction: rel.from.id === resource.id ? "outgoing" : "incoming",
                              }}
                              initial={{ type: rel.type, note: rel.note ?? "" }}
                              action={updateRelationshipAction.bind(
                                null,
                                ctx.workspaceSlug,
                                rel.id,
                              )}
                              trigger={
                                <button
                                  type="button"
                                  aria-label={`Edit relationship: ${readable}`}
                                  className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              }
                            />
                            <DeleteRelationshipButton
                              sentence={readable}
                              action={deleteRelationshipAction.bind(
                                null,
                                ctx.workspaceSlug,
                                rel.id,
                              )}
                            />
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
