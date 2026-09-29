// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { AUDIT_ACTIONS, AUDIT_GROUPS, type AuditGroup } from "@/lib/audit-actions";
import { formatDateTime, formatRelative } from "@/lib/format";
import { hasRole } from "@/server/authz";
import { AUDIT_RETENTION_DAYS, listAuditEvents } from "@/server/modules/audit/audit";
import { requireWorkspace } from "@/server/tenancy";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Audit log" };

const GROUP_VALUES = new Set<string>(AUDIT_GROUPS.map((g) => g.value));

function describeMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  if ("from" in meta && "to" in meta)
    return `${String(meta.from).toLowerCase()} → ${String(meta.to).toLowerCase()}`;
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v.toLowerCase() : String(v)}`)
    .join(" · ");
}

export default async function AuditLogPage({
  params,
  searchParams,
}: PageProps<"/w/[slug]/settings/audit">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  // Same 404 as for non-members: do not reveal the page to lower roles.
  if (!hasRole(ctx.role, "ADMIN")) notFound();
  const sp = await searchParams;
  const group =
    typeof sp.group === "string" && GROUP_VALUES.has(sp.group)
      ? (sp.group as AuditGroup)
      : undefined;
  const cursor = typeof sp.cursor === "string" ? sp.cursor.slice(0, 64) : undefined;
  const { events, nextCursor } = await listAuditEvents(ctx, { group, cursor });
  const base = `/w/${ctx.workspaceSlug}/settings/audit`;
  const href = (g?: AuditGroup, c?: string) => {
    const qs = new URLSearchParams();
    if (g) qs.set("group", g);
    if (c) qs.set("cursor", c);
    const s = qs.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`Who did what to members, integrations, agents and the workspace. Kept ${AUDIT_RETENTION_DAYS} days; cannot be edited.`}
      />
      <div className="flex max-w-5xl flex-1 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/w/${ctx.workspaceSlug}/settings`}
            className="text-subtle text-xs hover:underline"
          >
            ← Settings
          </Link>
          <Segmented
            items={[
              { label: "All", href: href(), active: !group },
              ...AUDIT_GROUPS.map((g) => ({
                label: g.label,
                href: href(g.value),
                active: group === g.value,
              })),
            ]}
          />
        </div>

        {events.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing recorded yet"
            description="Invitations, role changes, integrations, agent tokens and exports appear here."
          />
        ) : (
          <table className="border-border w-full rounded-lg border text-sm">
            <thead>
              <tr className="border-border text-subtle border-b text-left text-[11px] tracking-wider uppercase">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">What</th>
                <th className="px-4 py-2 font-medium">From</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td
                    className="text-muted px-4 py-2 text-xs whitespace-nowrap"
                    title={formatDateTime(e.createdAt)}
                  >
                    {formatRelative(e.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {e.actorType === "AGENT" ? (
                      <span>
                        agent on <span className="font-mono">{e.actorLabel}</span>
                      </span>
                    ) : e.actorType === "USER" ? (
                      (e.actorLabel ?? "a user")
                    ) : (
                      e.actorType.toLowerCase()
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span>{AUDIT_ACTIONS[e.action]?.label ?? e.action}</span>{" "}
                    {e.targetLabel && <span className="font-medium">{e.targetLabel}</span>}
                    {e.metadata && (
                      <p className="text-subtle mt-0.5 text-xs">{describeMeta(e.metadata)}</p>
                    )}
                  </td>
                  <td className="text-subtle px-4 py-2 font-mono text-xs">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <Link
            href={href(group, nextCursor)}
            className="text-muted self-start text-xs hover:underline"
          >
            Older events →
          </Link>
        )}
      </div>
    </>
  );
}
