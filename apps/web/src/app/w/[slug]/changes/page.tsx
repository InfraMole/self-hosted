// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import type { ChangeKind } from "@/generated/prisma/enums";
import { EmptyState } from "@/components/empty-state";
import { Segmented } from "@/components/segmented";
import { PageHeader } from "@/components/page-header";
import { CHANGE_KINDS } from "@/lib/change-presentation";
import { formatDateTime, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CHANGE_PERIODS,
  listWorkspaceChanges,
  type ChangeView,
  type ChangesFilter,
} from "@/server/modules/changes/changes";
import { markStaleHosts } from "@/server/modules/discovery/staleness";
import { requireWorkspace } from "@/server/tenancy";

export const metadata: Metadata = { title: "Changes" };

const PERIOD_LABEL: Record<number, string> = { 1: "24 hours", 7: "7 days", 30: "30 days" };
const ACTORS = [
  { value: "all", label: "Everyone" },
  { value: "human", label: "People" },
  { value: "agent", label: "Agents" },
  { value: "import", label: "Imports" },
  { value: "system", label: "System" },
] as const;

export default async function ChangesPage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/changes">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  await markStaleHosts(ctx.workspaceId); // throttled (ADR-016)
  const { filter, events, nextCursor, counts } = await listWorkspaceChanges(
    ctx,
    await searchParams,
  );
  const base = `/w/${ctx.workspaceSlug}`;

  const href = (patch: Partial<ChangesFilter>) => {
    const next = { ...filter, cursor: undefined, ...patch };
    const qs = new URLSearchParams();
    if (next.days !== 7) qs.set("days", String(next.days));
    if (next.actor !== "all") qs.set("actor", next.actor);
    if (next.kind) qs.set("kind", next.kind);
    if (next.cursor) qs.set("cursor", next.cursor);
    const s = qs.toString();
    return `${base}/changes${s ? `?${s}` : ""}`;
  };

  const byDay = new Map<string, ChangeView[]>();
  for (const e of events) {
    const day = formatDay(e.occurredAt);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const kindsWithCounts = (Object.keys(CHANGE_KINDS) as ChangeKind[]).filter((k) => counts[k]);

  return (
    <>
      <PageHeader
        title="Changes"
        description="What changed in your infrastructure — by people, agents and the system."
      />
      <div className="flex max-w-4xl flex-1 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            items={CHANGE_PERIODS.map((d) => ({
              label: PERIOD_LABEL[d]!,
              href: href({ days: d }),
              active: filter.days === d,
            }))}
          />
          <Segmented
            items={ACTORS.map((a) => ({
              label: a.label,
              href: href({ actor: a.value }),
              active: filter.actor === a.value,
            }))}
          />
        </div>

        {kindsWithCounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Summary">
            <span className="text-subtle text-xs">Last {PERIOD_LABEL[filter.days]}:</span>
            {kindsWithCounts.map((k) => {
              const meta = CHANGE_KINDS[k];
              const active = filter.kind === k;
              return (
                <Link
                  key={k}
                  href={href({ kind: active ? undefined : k })}
                  className={cn(
                    "inline-flex h-6 items-center gap-1.5 rounded border px-2 text-xs transition-colors",
                    active
                      ? "border-accent text-foreground"
                      : "border-border-strong text-muted hover:text-foreground",
                  )}
                >
                  <span className={cn("font-mono", meta.className)}>{meta.sign}</span>
                  <span className="font-mono">{counts[k]}</span> {meta.label.toLowerCase()}
                </Link>
              );
            })}
            {filter.kind && (
              <Link
                href={href({ kind: undefined })}
                className="text-subtle text-xs hover:underline"
              >
                clear
              </Link>
            )}
          </div>
        )}

        {events.length === 0 ? (
          <EmptyState
            icon={History}
            title="No changes in this period"
            description="New resources, detected connections, confirmations, IP changes, new services and hosts that stop reporting all show up here."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {[...byDay.entries()].map(([day, items]) => (
              <section key={day}>
                <h2 className="text-subtle mb-2 text-[11px] font-medium tracking-wider uppercase">
                  {day}
                </h2>
                <ol className="border-border divide-border divide-y rounded-lg border">
                  {items.map((e) => (
                    <ChangeRow key={e.id} event={e} base={base} />
                  ))}
                </ol>
              </section>
            ))}
            {nextCursor && (
              <Link
                href={href({ cursor: nextCursor })}
                className="text-accent self-start text-sm hover:underline"
              >
                Older changes →
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ChangeRow({ event: e, base }: { event: ChangeView; base: string }) {
  const meta = CHANGE_KINDS[e.kind];
  const href = e.linkResourceId
    ? `${base}/resources/${e.linkResourceId}${e.subjectType === "RELATIONSHIP" ? "/dependencies" : ""}`
    : null;
  const actor =
    e.actorType === "USER"
      ? (e.actorName ?? "a user")
      : e.actorType === "AGENT"
        ? `agent on ${e.actorName ?? "unknown host"}`
        : e.actorType === "IMPORTER"
          ? `import (${e.actorName ?? "file"})`
          : "system";
  const diff =
    e.diff && typeof e.diff === "object" ? Object.entries(e.diff as Record<string, unknown>) : [];

  return (
    <li className="flex gap-3 px-4 py-2.5">
      <span
        className={cn("w-3 shrink-0 font-mono text-sm leading-5", meta.className)}
        aria-label={meta.label}
      >
        {meta.sign}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {href ? (
            <Link href={href} className="hover:text-accent">
              {e.summary}
            </Link>
          ) : (
            e.summary
          )}
        </p>
        <p className="text-subtle mt-0.5 text-xs">
          {actor} · <time title={formatDateTime(e.occurredAt)}>{formatTime(e.occurredAt)} UTC</time>
        </p>
        {diff.length > 0 && (
          <details className="mt-1.5">
            <summary className="text-subtle hover:text-muted cursor-pointer text-xs">
              details
            </summary>
            <dl className="border-border bg-surface mt-1.5 rounded-md border px-3 py-2 font-mono text-xs">
              {diff.map(([field, value]) => (
                <div key={field} className="grid grid-cols-[120px_1fr] gap-3 py-0.5">
                  <dt className="text-subtle">{field}</dt>
                  <dd className="min-w-0 break-words">{describeValue(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </li>
  );
}

/** [before, after] pairs render as "before → after"; lists as comma-separated. */
function describeValue(value: unknown): string {
  const show = (v: unknown) =>
    v === null || v === undefined || v === "" ? "∅" : typeof v === "string" ? v : JSON.stringify(v);
  if (Array.isArray(value) && value.length === 2 && !value.every((v) => typeof v === "number")) {
    return `${show(value[0])} → ${show(value[1])}`;
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return show(value);
}
