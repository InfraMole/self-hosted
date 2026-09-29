// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { CHANGE_KINDS } from "@/lib/change-presentation";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listChangesForResource } from "@/server/modules/changes/changes";
import { DIFF_FIELDS } from "@/server/modules/resources/diff";
import { loadResource } from "../data";

export const metadata: Metadata = { title: "Activity" };

const KIND_MARK = CHANGE_KINDS;

export default async function ResourceActivityPage({
  params,
}: PageProps<"/w/[slug]/resources/[id]/activity">) {
  const { slug, id } = await params;
  const { ctx, resource } = await loadResource(slug, id);
  const events = await listChangesForResource(ctx, resource.id);

  if (events.length === 0) {
    return <p className="text-subtle text-sm">No activity recorded yet.</p>;
  }

  return (
    <ol className="border-border max-w-3xl border-l">
      {events.map((e) => {
        const mark = KIND_MARK[e.kind];
        const diff = (e.diff ?? {}) as Record<string, [unknown, unknown]>;
        return (
          <li key={e.id} className="relative pb-5 pl-5 last:pb-0">
            <span
              className={cn(
                "bg-background absolute top-0 -left-[7px] font-mono text-sm leading-5",
                mark.className,
              )}
              aria-hidden
            >
              {mark.sign}
            </span>
            <p className="text-sm">{e.summary}</p>
            <p className="text-subtle mt-0.5 text-xs">
              {e.actorName ?? e.actorType.toLowerCase()} ·{" "}
              <time dateTime={e.occurredAt.toISOString()} title={formatDateTime(e.occurredAt)}>
                {formatRelative(e.occurredAt)}
              </time>
            </p>
            {Object.keys(diff).length > 0 && (
              <dl className="border-border bg-surface mt-2 rounded-md border px-3 py-2 font-mono text-xs">
                {orderedDiff(diff).map(([field, [before, after]]) => (
                  <div key={field} className="grid grid-cols-[96px_1fr] gap-3 py-0.5">
                    <dt className="text-subtle">{field}</dt>
                    <dd className="min-w-0 break-words">
                      <span className="text-danger/80 line-through">{show(before)}</span>{" "}
                      <span className="text-success">{show(after)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** JSONB reorders keys; show fields in the canonical order used by summaries. */
function orderedDiff(diff: Record<string, [unknown, unknown]>) {
  const rank = (field: string) => {
    const i = (DIFF_FIELDS as readonly string[]).indexOf(field);
    return i === -1 ? DIFF_FIELDS.length : i;
  };
  return Object.entries(diff).sort(([a], [b]) => rank(a) - rank(b));
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
