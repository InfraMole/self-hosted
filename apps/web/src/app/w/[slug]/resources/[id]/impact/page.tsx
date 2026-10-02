// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { MarkFirstStep } from "@/components/onboarding/first-steps";
import Link from "next/link";
import { Network, ShieldCheck } from "lucide-react";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { EnvironmentLabel, TypeIcon } from "@/components/resources/resource-badges";
import { DepthSelect } from "@/components/impact/depth-select";
import { Button } from "@/components/ui/button";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import {
  DEFAULT_IMPACT_DEPTH,
  getResourceImpact,
  type AffectedView,
} from "@/server/modules/impact/impact";
import { loadResource } from "../data";

export const metadata: Metadata = { title: "Impact" };

const CONFIDENCE_COPY = {
  confirmed: "confirmed dependency",
  detected: "detected relationship",
  inferred: "inferred relationship",
} as const;

export default async function ImpactPage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/resources/[id]/impact">) {
  const { slug, id } = await params;
  const { ctx, resource } = await loadResource(slug, id);
  const { depth: rawDepth } = await searchParams;
  const parsedDepth = Number(rawDepth);
  const depth =
    Number.isInteger(parsedDepth) && parsedDepth >= 1 && parsedDepth <= DEFAULT_IMPACT_DEPTH
      ? parsedDepth
      : DEFAULT_IMPACT_DEPTH;

  const result = await getResourceImpact(ctx, resource.id, depth);
  const mapHref = `/w/${ctx.workspaceSlug}/map?impact=${resource.id}`;

  if (!result) {
    return (
      <p className="text-muted text-sm">
        Archived resources are not part of the dependency graph, so no impact is computed.
      </p>
    );
  }

  const groups = new Map<string, AffectedView[]>();
  for (const a of result.affected) {
    groups.set(a.resource.type, [...(groups.get(a.resource.type) ?? []), a]);
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <MarkFirstStep slug={ctx.workspaceSlug} step="impact" />
      <div className="border-border bg-surface rounded-lg border p-5">
        <p className="text-subtle text-[11px] font-medium tracking-wider uppercase">
          Potential blast radius
        </p>
        <p className="mt-2 text-lg">
          If <span className="font-mono">{resource.name}</span> fails,{" "}
          {result.summary.total === 0 ? (
            <>nothing recorded depends on it.</>
          ) : (
            <>
              <span className="text-warning font-medium">{result.summary.total}</span> resource
              {result.summary.total === 1 ? "" : "s"} could be affected.
            </>
          )}
        </p>
        {result.summary.total === 0 && (
          <p className="text-muted mt-2 text-sm">
            That is what InfraMole knows, not a guarantee. If something uses it, add the
            relationship on that resource — or let an agent on that server suggest it.
          </p>
        )}

        {result.summary.total > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {Object.entries(result.summary.byType).map(([type, count]) => (
              <span
                key={type}
                className="border-border-strong text-muted inline-flex h-6 items-center gap-1.5 rounded border px-2 text-xs"
              >
                <TypeIcon type={type as keyof typeof RESOURCE_TYPES} className="size-3.5" />
                {RESOURCE_TYPES[type as keyof typeof RESOURCE_TYPES].label}
                <span className="text-foreground font-mono">{count}</span>
              </span>
            ))}
            <span className="bg-border mx-1 h-4 w-px" aria-hidden />
            {(["confirmed", "detected", "inferred"] as const)
              .filter((c) => result.summary.byConfidence[c] > 0)
              .map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 text-xs">
                  <ConfidenceBadge confidence={c} />
                  <span className="font-mono">{result.summary.byConfidence[c]}</span>
                </span>
              ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" asChild>
            <Link href={mapHref}>
              <Network /> Show on map
            </Link>
          </Button>
          <DepthSelect value={depth} max={DEFAULT_IMPACT_DEPTH} />
        </div>
      </div>

      {result.summary.total === 0 ? (
        <div className="border-border text-muted flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
          <ShieldCheck className="text-subtle mt-0.5 size-4 shrink-0" />
          <p>
            No recorded relationship says that anything depends on{" "}
            <span className="font-mono">{resource.name}</span>. That does not prove nothing does —
            add relationships in <em>Dependencies</em>, or let an agent discover connections.
          </p>
        </div>
      ) : (
        [...groups.entries()].map(([type, items]) => (
          <section key={type}>
            <h2 className="mb-2 text-sm font-medium">
              {RESOURCE_TYPES[type as keyof typeof RESOURCE_TYPES].label}{" "}
              <span className="text-subtle font-mono text-xs">{items.length}</span>
            </h2>
            <ul className="border-border divide-border divide-y rounded-lg border">
              {items.map((a) => (
                <li key={a.resourceId} className="flex items-center gap-3 px-3 py-2">
                  <Link
                    href={`/w/${ctx.workspaceSlug}/resources/${a.resourceId}/impact`}
                    className="hover:text-accent flex w-48 shrink-0 items-center gap-2 font-mono text-[13px]"
                  >
                    <TypeIcon type={a.resource.type} />
                    <span className="truncate">{a.resource.name}</span>
                  </Link>
                  <span className="text-muted hidden w-28 shrink-0 text-xs md:inline">
                    <EnvironmentLabel environment={a.resource.environment} />
                  </span>
                  <span
                    className="text-subtle min-w-0 flex-1 truncate font-mono text-xs"
                    title={a.pathNames.join(" → ")}
                  >
                    {a.depth === 1 ? "direct" : `via ${a.pathNames.slice(1, -1).join(" → ")}`}
                  </span>
                  <span className="text-muted shrink-0 font-mono text-xs">
                    {a.depth} hop{a.depth === 1 ? "" : "s"}
                  </span>
                  <span title={`Weakest link on this path: ${CONFIDENCE_COPY[a.confidence]}`}>
                    <ConfidenceBadge confidence={a.confidence} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <p className="text-subtle text-xs leading-relaxed">
        Computed from recorded relationships that propagate failure. Informational links
        (monitoring, backups) are not included. Each resource shows the strongest evidence
        available: a <em>detected</em> or <em>inferred</em> relationship is a lead to verify, not
        proof that a failure will propagate.
      </p>
    </div>
  );
}
