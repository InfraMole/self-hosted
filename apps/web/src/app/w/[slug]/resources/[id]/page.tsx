// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  CriticalityLabel,
  EnvironmentLabel,
  StatusBadge,
} from "@/components/resources/resource-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/format";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { getHostDiscovery, type HostDiscovery } from "@/server/modules/discovery/discovery";
import { loadResource } from "./data";

export async function generateMetadata({
  params,
}: PageProps<"/w/[slug]/resources/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const { resource } = await loadResource(slug, id);
  return { title: resource.name };
}

const SOURCE_LABEL = { MANUAL: "Manual", AGENT: "Agent", IMPORT: "Import" } as const;

export default async function ResourceOverviewPage({
  params,
}: PageProps<"/w/[slug]/resources/[id]">) {
  const { slug, id } = await params;
  const { ctx, resource: r } = await loadResource(slug, id);
  const host = r.source === "AGENT" ? await getHostDiscovery(ctx, r.id) : null;
  const m = r.metadata;

  const allIdentity: [string, React.ReactNode][] = [
    ["Hostname", m.hostname],
    ["FQDN", m.fqdn],
    ["IP addresses", m.ipAddresses?.length ? m.ipAddresses.join("\n") : undefined],
    ["OS / platform", m.os && <span className="font-sans">{m.os}</span>],
    ["Version", m.version],
    ["Ports", m.ports?.length ? m.ports.join(", ") : undefined],
  ];
  const identity = allIdentity.filter(([, value]) => Boolean(value));

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        {r.description && <p className="text-sm">{r.description}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          {identity.length ? (
            <Rows rows={identity} mono />
          ) : (
            <CardContent className="text-subtle text-sm">
              No hostname, IPs or platform recorded. Add them with Edit — agents will fill these in
              automatically later.
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            {r.notes ? (
              // Plain text on purpose: user content is never rendered as HTML (SECURITY T5).
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.notes}</p>
            ) : (
              <p className="text-subtle text-sm">
                No notes. Context that only humans know belongs here.
              </p>
            )}
          </CardContent>
        </Card>

        {r.links.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
            </CardHeader>
            <ul className="divide-border divide-y">
              {r.links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="hover:bg-surface-2/60 flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
                  >
                    <span className="truncate">{link.label}</span>
                    <span className="text-subtle flex min-w-0 items-center gap-1.5 font-mono text-xs">
                      <span className="truncate">{new URL(link.url).host}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {host && (
          <ObservedOnHost host={host} suggestionsHref={`/w/${ctx.workspaceSlug}/suggestions`} />
        )}
      </div>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <Rows
            rows={[
              ["Type", RESOURCE_TYPES[r.type].label],
              ["Environment", <EnvironmentLabel key="e" environment={r.environment} />],
              ["Criticality", <CriticalityLabel key="c" criticality={r.criticality} />],
              ["Status", <StatusBadge key="s" status={r.status} />],
              [
                "Source",
                r.sourceRef ? (
                  // Provenance (ADR-021): everything from the same source, one click away.
                  <Link
                    key="src"
                    href={`/w/${ctx.workspaceSlug}/library?source=${encodeURIComponent(r.sourceRef)}`}
                    className="hover:text-accent underline-offset-4 hover:underline"
                  >
                    {r.sourceLabel ?? SOURCE_LABEL[r.source]}
                  </Link>
                ) : (
                  SOURCE_LABEL[r.source]
                ),
              ],
              [
                "Last seen",
                r.lastSeenAt ? (
                  <span title={formatDateTime(r.lastSeenAt)}>{formatRelative(r.lastSeenAt)}</span>
                ) : (
                  <span className="text-subtle">Not observed</span>
                ),
              ],
              [
                "Updated",
                <span key="u" title={formatDateTime(r.updatedAt)}>
                  {formatRelative(r.updatedAt)}
                </span>,
              ],
              [
                "Created",
                <span key="cr" title={formatDateTime(r.createdAt)}>
                  {formatRelative(r.createdAt)}
                </span>,
              ],
            ]}
            narrow
          />
        </Card>
        {r.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {r.tags.map((tag) => (
              <Badge key={tag} className="font-mono">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Rows({
  rows,
  mono = false,
  narrow = false,
}: {
  rows: [string, React.ReactNode][];
  mono?: boolean;
  narrow?: boolean;
}) {
  return (
    <dl className="divide-border divide-y">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className={`grid items-baseline gap-4 px-4 py-2 ${narrow ? "grid-cols-[96px_1fr]" : "grid-cols-[140px_1fr]"}`}
        >
          <dt className="text-muted text-xs">{label}</dt>
          <dd className={`text-sm whitespace-pre-line ${mono ? "font-mono text-[13px]" : ""}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** What this host's agent observed (M6). Unknown endpoints are never auto-created. */
function ObservedOnHost({
  host,
  suggestionsHref,
}: {
  host: HostDiscovery;
  suggestionsHref: string;
}) {
  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-4">
        <CardTitle>Observed on this host</CardTitle>
        <span className="text-subtle text-xs">
          {host.observedAt ? `agent report ${formatRelative(host.observedAt)}` : "no report yet"} ·{" "}
          {host.serviceCount} running services
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-muted mb-1.5 text-xs">Listening ports</p>
          {host.listeners.length === 0 ? (
            <p className="text-subtle text-sm">None reported.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {host.listeners.map((l) => (
                <Badge
                  key={`${l.address}:${l.port}`}
                  className="font-mono"
                  title={l.process ?? undefined}
                >
                  {l.port}
                  {l.process && <span className="text-subtle">{l.process}</span>}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-muted mb-1.5 text-xs">
            Unrecognised endpoints — add a resource with one of these IPs and it becomes a{" "}
            <a href={suggestionsHref} className="text-accent hover:underline">
              suggestion
            </a>
            .
          </p>
          {host.unknownEndpoints.length === 0 ? (
            <p className="text-subtle text-sm">None — every observed peer is in the Library.</p>
          ) : (
            <ul className="divide-border divide-y font-mono text-xs">
              {host.unknownEndpoints.map((u) => (
                <li
                  key={`${u.direction}${u.remoteIp}:${u.port}${u.processName}`}
                  className="flex gap-3 py-1.5"
                >
                  <span className="text-subtle w-8">
                    {u.direction === "OUTBOUND" ? "out" : "in"}
                  </span>
                  <span className="flex-1 truncate">
                    {u.remoteIp}
                    {u.direction === "OUTBOUND" ? `:${u.port}` : ` → :${u.port}`}
                  </span>
                  <span className="text-muted w-32 truncate">{u.processName || "—"}</span>
                  <span className="text-subtle w-20 text-right">{u.sampleCount} samples</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
