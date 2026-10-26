// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { RELATIONSHIP_TYPE_INFO, dependencyDirection, edgeConfidence } from "@depmap/graph";
import type { ReviewState } from "@/app/w/[slug]/suggestions/actions";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { TypeIcon } from "@/components/resources/resource-badges";
import { SuggestionActions } from "@/components/suggestions/suggestion-actions";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { RelationshipDetail } from "@/server/modules/discovery/discovery";
import type { MapEdge, MapNode } from "@/server/modules/map/map";

interface Props {
  edge: MapEdge;
  byId: Map<string, MapNode>;
  /** Absent on a public share page: only the sentence and its confidence are shown. */
  loadDetail?: (id: string) => Promise<RelationshipDetail | null>;
  /** MEMBER+ on a suggestion: review it from the map. */
  confirm?: (id: string, input: { type?: string; note?: string }) => Promise<ReviewState>;
  ignore?: (id: string) => Promise<ReviewState>;
  onSelectResource: (id: string) => void;
  onClose: () => void;
}

const STATUS_COPY = {
  CONFIRMED: "Confirmed by a person",
  UNCONFIRMED: "Suggestion — not confirmed yet",
  IGNORED: "Ignored",
} as const;

const ACTOR_COPY: Record<string, string> = {
  USER: "Added by",
  IMPORTER: "Imported from",
  AGENT: "Proposed by discovery, from the agent on",
  SYSTEM: "Proposed by InfraMole",
};

/**
 * M40: a line on the map, explained — what it says, how sure it is and
 * where it comes from. Evidence is loaded on demand (maps can have thousands
 * of lines) and never on a public share page.
 */
export function RelationshipInspector({
  edge,
  byId,
  loadDetail,
  confirm,
  ignore,
  onSelectResource,
  onClose,
}: Props) {
  const confidence = edgeConfidence(edge.status, edge.origin)!;
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  const informational = dependencyDirection(edge) === null;
  const [detail, setDetail] = useState<{ key: string; value: RelationshipDetail | null } | null>(
    null,
  );
  const key = `${edge.id}:${edge.status}`;

  useEffect(() => {
    if (!loadDetail) return;
    let live = true;
    loadDetail(edge.id).then(
      (value) => live && setDetail({ key, value }),
      () => live && setDetail({ key, value: null }),
    );
    return () => {
      live = false;
    };
  }, [loadDetail, edge.id, key]);
  const d = detail?.key === key ? detail.value : undefined;

  const end = (r: MapNode | undefined) =>
    r ? (
      <button
        type="button"
        onClick={() => onSelectResource(r.id)}
        className="hover:text-accent inline-flex min-w-0 items-center gap-1.5 font-mono text-sm"
      >
        <TypeIcon type={r.type} tech={r.tech} className="size-3.5" />
        <span className="truncate">{r.name}</span>
      </button>
    ) : (
      <span className="text-subtle">?</span>
    );

  return (
    <aside
      className="border-border bg-surface flex w-80 shrink-0 flex-col border-l max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:max-h-[60%] max-md:w-auto max-md:overflow-y-auto max-md:border-t max-md:border-l-0 max-md:shadow-lg"
      aria-label="Relationship details"
    >
      <div className="border-border flex items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-subtle text-[11px] font-medium tracking-wider uppercase">
            Relationship
          </p>
          <p className="text-muted text-xs">{STATUS_COPY[edge.status]}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close relationship details"
          className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          {end(from)}
          <p className="text-muted flex items-center gap-1.5 text-xs">
            {RELATIONSHIP_TYPE_INFO[edge.type].label}
            <ArrowRight className="size-3.5" />
          </p>
          {end(to)}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ConfidenceBadge confidence={confidence} />
          <span className="text-muted">
            {informational
              ? "Informational — not followed by impact"
              : confidence === "confirmed"
                ? "Impact follows it as a dependency"
                : "Impact shows it as a lead to verify"}
          </span>
        </div>

        {!loadDetail ? (
          <p className="text-subtle text-xs">Where it comes from is not shown on a shared map.</p>
        ) : d === undefined ? (
          <p className="text-subtle text-xs" aria-busy>
            Loading where it comes from…
          </p>
        ) : d === null ? (
          <p className="text-subtle text-xs">This relationship no longer exists.</p>
        ) : (
          <Evidence detail={d} />
        )}

        {d && d.status === "UNCONFIRMED" && confirm && ignore && (
          <SuggestionActions
            fromName={d.from.name}
            toName={d.to.name}
            currentType={d.type}
            suggestedType={d.evidence.suggestedType}
            confirm={(input) => confirm(d.id, input)}
            ignore={() => ignore(d.id)}
          />
        )}
      </div>
    </aside>
  );
}

function Evidence({ detail: d }: { detail: RelationshipDetail }) {
  const e = d.evidence;
  const rows: [string, React.ReactNode][] = [];
  if (e.observed || e.sessions > 0) {
    if (e.ports.length)
      rows.push([
        "Ports",
        <span key="v1" className="font-mono">
          {e.ports.join(", ")}
        </span>,
      ]);
    if (e.protocols.length) rows.push(["Likely", e.protocols.join(" / ")]);
    if (e.processes.length)
      rows.push([
        "Process",
        <span key="v2" className="font-mono">
          {e.processes.slice(0, 3).join(", ")}
        </span>,
      ]);
    if (e.samples > 0)
      rows.push([
        "Samples",
        <span key="v3" className="font-mono">
          {e.samples}
        </span>,
      ]);
  }
  if (e.sessions > 0)
    rows.push([
      "Sessions",
      `Seen in the database server's sessions (${e.sessions} at its last report)`,
    ]);
  if (e.dnsResolver)
    rows.push(["DNS", `Configured as its DNS server${e.observed ? "" : " — no traffic observed"}`]);
  if (e.firstSeenAt)
    rows.push([
      "First seen",
      <span key="v4" title={formatDateTime(e.firstSeenAt)}>
        {formatRelative(e.firstSeenAt)}
      </span>,
    ]);
  if (e.lastSeenAt)
    rows.push([
      e.observed || e.sessions > 0 ? "Last seen" : "Last reported",
      <span key="v5" title={formatDateTime(e.lastSeenAt)}>
        {formatRelative(e.lastSeenAt)}
      </span>,
    ]);
  if (d.addedBy)
    rows.push([
      "Origin",
      `${ACTOR_COPY[d.addedBy.actorType] ?? "Added by"} ${d.addedBy.name ?? "someone no longer here"}`,
    ]);
  else if (d.origin === "MANUAL") rows.push(["Origin", "Added by hand"]);
  rows.push([
    "Recorded",
    <span key="v6" title={formatDateTime(d.createdAt)}>
      {formatRelative(d.createdAt)}
    </span>,
  ]);
  if (d.confirmedAt)
    rows.push([
      "Confirmed",
      <span key="v7" title={formatDateTime(d.confirmedAt)}>
        {formatRelative(d.confirmedAt)}
        {d.confirmedBy ? ` by ${d.confirmedBy}` : ""}
      </span>,
    ]);

  return (
    <section>
      <h3 className="text-subtle mb-1.5 text-[11px] font-medium tracking-wider uppercase">
        Where it comes from
      </h3>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {!e.observed && !e.dnsResolver && e.sessions === 0 && d.origin !== "MANUAL" && (
        <p className="text-subtle mt-2 text-xs">No observed traffic recorded for it.</p>
      )}
      {d.note && <p className="text-muted mt-2 text-xs whitespace-pre-wrap">{d.note}</p>}
    </section>
  );
}
