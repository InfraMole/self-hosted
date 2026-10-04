// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteIntegrationDialog } from "@/components/integrations/delete-integration-dialog";
import { IntegrationSheet, SyncNowButton } from "@/components/integrations/integration-sheet";
import { CreateTokenDialog } from "@/components/agents/create-token-dialog";
import { CreateApiTokenDialog } from "@/components/settings/create-api-token-dialog";
import { InviteSheet, RoleSelect } from "@/components/members/invite-sheet";
import { DeleteWorkspaceDialog } from "@/components/settings/delete-workspace-dialog";
import { RequireTwoFactorToggle } from "@/components/settings/require-two-factor-toggle";
import { RevokeButton } from "@/components/agents/revoke-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasRole, type Role } from "@/server/authz";
import {
  agentHealth,
  listAgents,
  listEnrollmentTokens,
  type TokenState,
} from "@/server/modules/agents/agents";
import { listApiTokens, type ApiTokenState } from "@/server/modules/api/tokens";
import { listShares } from "@/server/modules/map/shares";
import { integrationsEnabled, listIntegrations } from "@/server/modules/integrations/integrations";
import { INTEGRATION_FORMS } from "@/lib/integration-forms";
import { listInvitations, listMembers } from "@/server/modules/members/members";
import { markStaleHosts } from "@/server/modules/discovery/staleness";
import { listSources } from "@/server/modules/resources/sources";
import { requireWorkspace } from "@/server/tenancy";
import { versionInfo } from "@/server/version";
import { createTokenAction, revokeAgentAction, revokeTokenAction } from "./actions";
import { createApiTokenAction, revokeApiTokenAction, revokeShareAction } from "./api-actions";
import {
  createIntegrationAction,
  deleteIntegrationAction,
  syncIntegrationAction,
  testIntegrationAction,
} from "./integration-actions";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "./member-actions";
import { deleteWorkspaceAction, setRequireTwoFactorAction } from "./workspace-actions";

export const metadata: Metadata = { title: "Settings" };

const HEALTH = {
  reporting: { label: "Reporting", dot: "bg-success" },
  silent: { label: "Not reporting", dot: "bg-warning" },
  pending: { label: "Waiting for first report", dot: "bg-subtle" },
  revoked: { label: "Revoked", dot: "bg-danger" },
} as const;

const TOKEN_STATE: Record<TokenState, string> = {
  active: "border-success/50 text-success",
  expired: "border-border text-subtle",
  revoked: "border-danger/50 text-danger",
  exhausted: "border-border text-subtle",
};

const API_TOKEN_STATE: Record<ApiTokenState, string> = {
  active: "border-success/50 text-success",
  expired: "border-border text-subtle",
  revoked: "border-danger/50 text-danger",
};

export default async function SettingsPage({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug);
  await markStaleHosts(ctx.workspaceId); // throttled (ADR-016)
  const isAdmin = hasRole(ctx.role, "ADMIN");
  const isOwner = ctx.role === "OWNER";
  const [agents, tokens, integrations, members, invitations, version, apiTokens, shares] =
    await Promise.all([
      listAgents(ctx),
      isAdmin ? listEnrollmentTokens(ctx) : Promise.resolve([]),
      isAdmin ? listIntegrations(ctx) : Promise.resolve([]),
      listMembers(ctx),
      isAdmin ? listInvitations(ctx) : Promise.resolve([]),
      versionInfo(),
      isAdmin ? listApiTokens(ctx) : Promise.resolve([]),
      isAdmin ? listShares(ctx) : Promise.resolve([]),
    ]);
  const assignable: Role[] = isOwner
    ? ["VIEWER", "MEMBER", "ADMIN", "OWNER"]
    : ["VIEWER", "MEMBER", "ADMIN"];
  const canStoreSecrets = integrationsEnabled();
  // Resources each integration created and nobody archived (ADR-021), for the delete dialog.
  const ownedBySource = new Map(
    (isAdmin ? await listSources(ctx) : []).map((s) => [s.ref, s.total - s.archived]),
  );

  const rows: [string, string, boolean][] = [
    ["Name", ctx.workspaceName, false],
    ["Slug", ctx.workspaceSlug, true],
    ["Workspace ID", ctx.workspaceId, true],
    ["Your role", ctx.role.toLowerCase(), false],
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace configuration, members, discovery agents and integrations."
      />
      <div className="flex max-w-4xl flex-col gap-6 p-6">
        <Card>
          <CardHeader className="flex items-center justify-between gap-4">
            <CardTitle>Workspace</CardTitle>
            {isAdmin && (
              <Link
                href={`/w/${ctx.workspaceSlug}/settings/audit`}
                className="text-muted hover:text-foreground text-xs"
              >
                Audit log →
              </Link>
            )}
            {isAdmin && (
              <Link
                href={`/w/${ctx.workspaceSlug}/settings/billing`}
                className="text-muted hover:text-foreground text-xs"
              >
                Plan &amp; billing →
              </Link>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <dl className="divide-border divide-y">
              {rows.map(([label, value, mono]) => (
                <div
                  key={label}
                  className="grid grid-cols-[160px_1fr] items-baseline gap-4 px-4 py-2.5"
                >
                  <dt className="text-muted text-xs">{label}</dt>
                  <dd className={mono ? "font-mono text-xs" : "text-sm"}>{value}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[160px_1fr] items-baseline gap-4 px-4 py-2.5">
                <dt className="text-muted text-xs">InfraMole version</dt>
                <dd className="text-sm">
                  <span className="font-mono text-xs">
                    {version.current ?? "development build"}
                  </span>
                  {isAdmin && version.newer && (
                    <span className="text-warning ml-3 text-xs">
                      {version.newer} is available —{" "}
                      <Link
                        href="/docs/operations/upgrade"
                        className="underline-offset-4 hover:underline"
                      >
                        upgrade guide
                      </Link>{" "}
                      ·{" "}
                      <a
                        href="https://github.com/InfraMole/self-hosted/blob/main/CHANGELOG.md"
                        className="underline-offset-4 hover:underline"
                      >
                        what changed
                      </a>
                    </span>
                  )}
                  {isAdmin && version.current && !version.checking && (
                    <span className="text-subtle ml-3 text-xs">
                      Set <span className="font-mono">UPDATE_CHECK=true</span> to be told about new
                      releases.
                    </span>
                  )}
                </dd>
              </div>
              <div className="grid grid-cols-[160px_1fr] items-baseline gap-4 px-4 py-2.5">
                <dt className="text-muted text-xs">Security</dt>
                <dd>
                  <RequireTwoFactorToggle
                    value={Boolean(ctx.requireTwoFactor)}
                    editable={ctx.role === "OWNER"}
                    action={setRequireTwoFactorAction.bind(null, ctx.workspaceSlug)}
                  />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card id="members">
          <CardHeader className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Members</CardTitle>
              <p className="text-muted mt-0.5 text-xs">
                Viewers read, members edit, admins also manage agents, integrations and members.
              </p>
            </div>
            {isAdmin && (
              <InviteSheet
                action={inviteMemberAction.bind(null, ctx.workspaceSlug)}
                canInviteOwner={isOwner}
              />
            )}
          </CardHeader>
          <ul className="divide-border divide-y">
            {members.map((m) => {
              const self = m.userId === ctx.userId;
              // Only owners may touch owners; admins manage everyone else.
              const manageable = isAdmin && (m.role !== "OWNER" || isOwner);
              return (
                <li key={m.userId} className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {m.name} {self && <span className="text-subtle text-xs">(you)</span>}
                    </p>
                    <p className="text-subtle truncate text-xs">{m.email}</p>
                  </div>
                  <span className="text-subtle text-xs" title={formatDateTime(m.joinedAt)}>
                    joined {formatRelative(m.joinedAt)}
                  </span>
                  {manageable ? (
                    <RoleSelect
                      value={m.role}
                      roles={assignable}
                      label={`Role of ${m.name}`}
                      action={changeRoleAction.bind(null, ctx.workspaceSlug, m.userId)}
                    />
                  ) : (
                    <Badge>{m.role.toLowerCase()}</Badge>
                  )}
                  <span className="w-16 text-right">
                    {(manageable || self) && (
                      <RevokeButton
                        verb={self ? "Leave" : "Remove"}
                        label={self ? "Leave workspace" : `Remove ${m.name}`}
                        title={self ? `Leave ${ctx.workspaceName}?` : `Remove ${m.name}?`}
                        description={
                          self
                            ? "You lose access immediately. Someone will have to invite you again."
                            : "They lose access immediately. Everything they created stays."
                        }
                        action={removeMemberAction.bind(null, ctx.workspaceSlug, m.userId)}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {invitations.length > 0 && (
            <>
              <p className="border-border text-subtle border-t px-4 pt-3 pb-1 text-[11px] tracking-wider uppercase">
                Pending invitations
              </p>
              <ul className="divide-border divide-y">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{i.email}</span>
                    <span className="text-subtle text-xs">invited by {i.invitedByName}</span>
                    <Badge>{i.role.toLowerCase()}</Badge>
                    <span
                      className={cn(
                        "w-28 text-right text-xs",
                        i.state === "expired" ? "text-danger" : "text-muted",
                      )}
                      title={formatDateTime(i.expiresAt)}
                    >
                      {i.state === "expired" ? "expired" : `expires ${formatRelative(i.expiresAt)}`}
                    </span>
                    <span className="w-16 text-right">
                      <RevokeButton
                        label={`Revoke invitation for ${i.email}`}
                        title={`Revoke the invitation for ${i.email}?`}
                        description="The link stops working immediately."
                        action={revokeInvitationAction.bind(null, ctx.workspaceSlug, i.id)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card id="agents">
          <CardHeader className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Agents</CardTitle>
              <p className="text-muted mt-0.5 text-xs">
                Read-only discovery agents. Each host they report appears in the Library as{" "}
                <em>Discovered</em>.
              </p>
            </div>
            {isAdmin && (
              <CreateTokenDialog action={createTokenAction.bind(null, ctx.workspaceSlug)} />
            )}
          </CardHeader>
          {agents.length === 0 ? (
            <CardContent className="text-subtle text-sm">
              No agents yet.{" "}
              {isAdmin
                ? "Create an enrollment token and install the agent on a server."
                : "Ask an admin to enroll one."}
            </CardContent>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-subtle border-b text-left text-[11px] tracking-wider uppercase">
                  <th className="px-4 py-2 font-medium">Host</th>
                  <th className="px-4 py-2 font-medium">OS</th>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Last seen</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {agents.map((a) => {
                  const health = HEALTH[agentHealth(a)];
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn("size-1.5 rounded-full", health.dot)}
                            title={health.label}
                          />
                          {a.resourceId ? (
                            <Link
                              href={`/w/${ctx.workspaceSlug}/resources/${a.resourceId}`}
                              className="hover:text-accent font-mono text-[13px]"
                            >
                              {a.hostname}
                            </Link>
                          ) : (
                            <span className="font-mono text-[13px]">{a.hostname}</span>
                          )}
                        </div>
                        <p className="text-subtle mt-0.5 pl-3.5 text-[11px]">{health.label}</p>
                      </td>
                      <td className="text-muted px-4 py-2 text-xs">
                        {a.os} <span className="text-subtle">{a.osVersion}</span>
                      </td>
                      <td className="text-muted px-4 py-2 font-mono text-xs">{a.agentVersion}</td>
                      <td className="text-muted px-4 py-2 text-xs">
                        {a.lastSeenAt ? (
                          <span title={formatDateTime(a.lastSeenAt)}>
                            {formatRelative(a.lastSeenAt)}
                          </span>
                        ) : (
                          "—"
                        )}
                        {a.lastIp && (
                          <p className="text-subtle font-mono text-[11px]">{a.lastIp}</p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isAdmin && a.status === "ACTIVE" && (
                          <RevokeButton
                            label={`Revoke agent ${a.hostname}`}
                            title={`Revoke agent on ${a.hostname}?`}
                            description="Its credential stops working immediately; the host stays in the Library. Re-enrolling needs a new token."
                            action={revokeAgentAction.bind(null, ctx.workspaceSlug, a.id)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Enrollment tokens</CardTitle>
              <p className="text-muted mt-0.5 text-xs">
                Tokens are shown once and stored hashed. Revoking a token does not affect agents
                already enrolled with it.
              </p>
            </CardHeader>
            {tokens.length === 0 ? (
              <CardContent className="text-subtle text-sm">No tokens.</CardContent>
            ) : (
              <ul className="divide-border divide-y">
                {tokens.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <span className="text-subtle font-mono text-xs">{t.prefix}…</span>
                    <Badge className={TOKEN_STATE[t.state]}>{t.state}</Badge>
                    <span
                      className="text-muted w-32 text-right text-xs"
                      title={formatDateTime(t.expiresAt)}
                    >
                      {t.state === "active" ? `expires ${formatRelative(t.expiresAt)}` : ""}
                    </span>
                    <span className="text-muted w-16 text-right font-mono text-xs">
                      {t.useCount}
                      {t.maxUses !== null ? `/${t.maxUses}` : ""} used
                    </span>
                    <span className="w-16 text-right">
                      {t.state === "active" && (
                        <RevokeButton
                          label={`Revoke token ${t.name}`}
                          title={`Revoke token “${t.name}”?`}
                          description="No new agents can enroll with it. Existing agents keep working."
                          action={revokeTokenAction.bind(null, ctx.workspaceSlug, t.id)}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {isAdmin && (
          <Card id="integrations">
            <CardHeader className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Integrations</CardTitle>
                <p className="text-muted mt-0.5 text-xs">
                  Read-only API credentials (clouds, DNS, Tailscale, Proxmox, NAS), encrypted at
                  rest and synced on a schedule through the importer. Imported hosts appear as{" "}
                  <em>Discovered</em>.
                </p>
              </div>
              {canStoreSecrets && (
                <IntegrationSheet
                  test={testIntegrationAction.bind(null, ctx.workspaceSlug)}
                  save={createIntegrationAction.bind(null, ctx.workspaceSlug)}
                />
              )}
            </CardHeader>
            {!canStoreSecrets ? (
              <CardContent className="text-subtle text-sm">
                Disabled: the server has no{" "}
                <code className="font-mono text-xs">CREDENTIALS_ENCRYPTION_KEY</code>. Uploading
                exports in <em>Import</em> still works.
              </CardContent>
            ) : integrations.length === 0 ? (
              <CardContent className="text-subtle text-sm">
                No integrations. Connect a cloud, a DNS provider or a local source with a read-only
                credential.
              </CardContent>
            ) : (
              <ul className="divide-border divide-y">
                {integrations.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        i.lastSyncOk === null
                          ? "bg-subtle"
                          : i.lastSyncOk
                            ? "bg-success"
                            : "bg-danger",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {i.name}{" "}
                        <span className="text-subtle text-xs">
                          {INTEGRATION_FORMS[i.kind].label} · every {i.syncIntervalHours} h
                        </span>
                      </p>
                      <p
                        className={cn(
                          "truncate text-[11px]",
                          i.lastSyncOk === false ? "text-danger" : "text-subtle",
                        )}
                        title={i.lastSyncMessage ?? undefined}
                      >
                        {i.lastSyncAt
                          ? `Synced ${formatRelative(i.lastSyncAt)}${i.lastSyncMessage ? ` — ${i.lastSyncMessage}` : ""}`
                          : "Never synced"}
                      </p>
                    </div>
                    {i.secretHint && (
                      <span
                        className="text-subtle font-mono text-xs"
                        title="Last characters of the stored secret"
                      >
                        …{i.secretHint}
                      </span>
                    )}
                    <SyncNowButton
                      action={syncIntegrationAction.bind(null, ctx.workspaceSlug, i.id)}
                    />
                    <DeleteIntegrationDialog
                      name={i.name}
                      owned={ownedBySource.get(`integration:${i.id}`) ?? 0}
                      action={deleteIntegrationAction.bind(null, ctx.workspaceSlug, i.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {isAdmin && (
          <Card id="api">
            <CardHeader className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>API tokens</CardTitle>
                <p className="text-muted mt-0.5 text-xs">
                  Read-only access to this workspace for scripts and other tools — resources,
                  relationships, impact and paths.{" "}
                  <Link href="/docs/reference/api" className="text-accent hover:underline">
                    API reference
                  </Link>
                </p>
              </div>
              <CreateApiTokenDialog action={createApiTokenAction.bind(null, ctx.workspaceSlug)} />
            </CardHeader>
            {apiTokens.length === 0 ? (
              <CardContent className="text-subtle text-sm">No API tokens.</CardContent>
            ) : (
              <ul className="divide-border divide-y">
                {apiTokens.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <span className="text-subtle font-mono text-xs">{t.prefix}…</span>
                    <Badge className={API_TOKEN_STATE[t.state]}>{t.state}</Badge>
                    <span
                      className="text-muted w-28 text-right text-xs"
                      title={t.lastUsedAt ? formatDateTime(t.lastUsedAt) : undefined}
                    >
                      {t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : "never used"}
                    </span>
                    <span
                      className="text-muted w-32 text-right text-xs"
                      title={t.expiresAt ? formatDateTime(t.expiresAt) : undefined}
                    >
                      {t.state !== "active"
                        ? ""
                        : t.expiresAt
                          ? `expires ${formatRelative(t.expiresAt)}`
                          : "no expiry"}
                    </span>
                    <span className="w-16 text-right">
                      {t.state === "active" && (
                        <RevokeButton
                          label={`Revoke API token ${t.name}`}
                          title={`Revoke API token “${t.name}”?`}
                          description="Scripts using it stop working immediately."
                          action={revokeApiTokenAction.bind(null, ctx.workspaceSlug, t.id)}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {isAdmin && (
          <Card id="shares">
            <CardHeader>
              <CardTitle>Public map links</CardTitle>
              <p className="text-muted mt-0.5 text-xs">
                Read-only links to a saved view, for people without an account — no IP addresses,
                owners or notes. Create one from the map: <em>Views</em> › link icon of a view.
              </p>
            </CardHeader>
            {shares.length === 0 ? (
              <CardContent className="text-subtle text-sm">No public links.</CardContent>
            ) : (
              <ul className="divide-border divide-y">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                    <Link
                      href={`/w/${ctx.workspaceSlug}/map?view=${s.viewId}`}
                      className="hover:text-accent min-w-0 flex-1 truncate text-sm"
                    >
                      {s.viewName}
                    </Link>
                    <span className="text-subtle font-mono text-xs">{s.prefix}…</span>
                    <Badge className={API_TOKEN_STATE[s.state]}>{s.state}</Badge>
                    <span
                      className="text-muted w-28 text-right text-xs"
                      title={s.lastViewedAt ? formatDateTime(s.lastViewedAt) : undefined}
                    >
                      {s.lastViewedAt ? `opened ${formatRelative(s.lastViewedAt)}` : "never opened"}
                    </span>
                    <span
                      className="text-muted w-32 text-right text-xs"
                      title={s.expiresAt ? formatDateTime(s.expiresAt) : undefined}
                    >
                      {s.state !== "active"
                        ? ""
                        : s.expiresAt
                          ? `expires ${formatRelative(s.expiresAt)}`
                          : "no expiry"}
                    </span>
                    <span className="w-16 text-right">
                      {s.state === "active" && (
                        <RevokeButton
                          label={`Revoke public link to ${s.viewName}`}
                          title={`Revoke the public link to “${s.viewName}”?`}
                          description="Anyone using it sees “not found” from now on."
                          action={revokeShareAction.bind(null, ctx.workspaceSlug, s.id)}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {isAdmin && (
          <Card id="data">
            <CardHeader>
              <CardTitle>Data</CardTitle>
              <p className="text-muted mt-0.5 text-xs">
                Your data is yours. The export is a JSON file you can re-import into another
                workspace (Library › Import); it never contains secrets or credentials.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <a
                href={`/w/${ctx.workspaceSlug}/settings/export`}
                className="border-border-strong hover:bg-surface-2 inline-flex h-8 items-center rounded-md border px-3 text-xs"
              >
                Export workspace data (JSON)
              </a>
              {ctx.role === "OWNER" && (
                <DeleteWorkspaceDialog
                  name={ctx.workspaceName}
                  action={deleteWorkspaceAction.bind(null, ctx.workspaceSlug)}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
