// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import type { SsoActionResult } from "@/app/w/[slug]/settings/sso-actions";
import { CopyBlock } from "@/components/agents/create-token-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatGroupRules, type GroupRole, type SsoRole } from "@/lib/sso-roles";

export interface SsoRow {
  id: string;
  protocol: "OIDC" | "SAML" | "LDAP";
  name: string;
  domain: string;
  domainVerified: boolean;
  enabled: boolean;
  enforced: boolean;
  defaultRole: SsoRole | null;
  groupsClaim: string;
  groupRules: GroupRole[];
  issuer: string | null;
  clientId: string | null;
  spCertificate: string | null;
  /** LDAP settings (never the service account's password). */
  ldap: { url: string; bindDn: string; baseDn: string; userFilter: string } | null;
  /** What the identity provider administrator needs. */
  details: { redirectUri: string; acsUrl: string; entityId: string; metadataUrl: string };
  /** DNS proof (owners only). */
  dns: { name: string; value: string } | null;
}

type Action = (input: unknown) => Promise<SsoActionResult>;
type Protocol = SsoRow["protocol"];

/** Settings › Single sign-on (M33, ADR-048): owners manage, admins see. */
export function SsoCard({
  rows,
  canManage,
  secretsAvailable,
  create,
  update,
  verify,
  setEnabled,
  remove,
}: {
  rows: SsoRow[];
  canManage: boolean;
  /** Secrets are stored sealed with CREDENTIALS_ENCRYPTION_KEY (ADR-053): no key, no changes. */
  secretsAvailable: boolean;
  create: Action;
  update: (id: string, input: unknown) => Promise<SsoActionResult>;
  verify: (id: string) => Promise<SsoActionResult>;
  setEnabled: (id: string, enabled: boolean) => Promise<SsoActionResult>;
  remove: (id: string) => Promise<SsoActionResult>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SsoRow | "new" | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const act = (id: string, fn: () => Promise<SsoActionResult>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      setFeedback((f) => ({ ...f, [id]: res.ok ? done : res.error }));
      if (res.ok) router.refresh();
    });

  return (
    <>
      {rows.length === 0 ? (
        <CardContent className="text-subtle text-sm">
          No single sign-on yet. People sign in with a password, a passkey, or Google / Microsoft.
        </CardContent>
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="text-subtle size-4" />
                <span className="text-sm font-medium">{r.name}</span>
                <Badge>{r.protocol}</Badge>
                <span className="font-mono text-xs">@{r.domain}</span>
                {r.domainVerified ? (
                  <Badge className="border-success/50 text-success">verified</Badge>
                ) : (
                  <Badge className="border-warning/50 text-warning">domain not verified</Badge>
                )}
                {!r.enabled && <Badge className="text-subtle">disabled</Badge>}
                {r.enforced && <Badge>SSO only</Badge>}
                {canManage && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        act(
                          r.id,
                          () => setEnabled(r.id, !r.enabled),
                          r.enabled ? "Disabled." : "Enabled.",
                        )
                      }
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Delete single sign-on ${r.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete “${r.name}”? People of @${r.domain} can no longer sign in with it.`,
                          )
                        )
                          act(r.id, () => remove(r.id), "Deleted.");
                      }}
                    >
                      Delete
                    </Button>
                  </span>
                )}
              </div>
              <p className="text-muted text-xs">
                {r.groupRules.length
                  ? `${r.groupRules.length} group rule${r.groupRules.length === 1 ? "" : "s"}`
                  : "No group rules"}
                {" · "}
                {r.defaultRole
                  ? `others: ${r.defaultRole.toLowerCase()}`
                  : "people in no mapped group are refused"}
              </p>
              {canManage && r.protocol !== "LDAP" && (
                <details className="text-xs">
                  <summary className="text-muted hover:text-foreground cursor-pointer">
                    Settings for your identity provider
                  </summary>
                  <div className="mt-2 space-y-2">
                    {r.protocol === "OIDC" ? (
                      <CopyBlock label="Redirect URI" value={r.details.redirectUri} />
                    ) : (
                      <>
                        <CopyBlock label="Entity ID (audience)" value={r.details.entityId} />
                        <CopyBlock label="Reply URL (ACS)" value={r.details.acsUrl} />
                        <CopyBlock
                          label="Service provider metadata"
                          value={r.details.metadataUrl}
                        />
                        {r.spCertificate && (
                          <CopyBlock
                            label="Signing certificate (if your provider asks for it)"
                            value={r.spCertificate}
                          />
                        )}
                      </>
                    )}
                  </div>
                </details>
              )}
              {!r.domainVerified && r.dns && canManage && (
                <div className="border-warning/40 bg-surface-2 space-y-2 rounded-md border p-3 text-xs">
                  <p>
                    Prove you own <span className="font-mono">{r.domain}</span>: add this DNS TXT
                    record, then verify. Until then nobody can sign in with this connection.
                  </p>
                  <CopyBlock label="Name" value={r.dns.name} />
                  <CopyBlock label="Value" value={r.dns.value} />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => act(r.id, () => verify(r.id), "Domain verified.")}
                  >
                    Verify domain
                  </Button>
                </div>
              )}
              {feedback[r.id] && (
                <p role="status" className="text-muted text-xs">
                  {feedback[r.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <CardContent className="pt-0">
          {secretsAvailable ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
              <Plus /> Add single sign-on
            </Button>
          ) : (
            <p className="text-subtle text-xs">
              Single sign-on stores its secrets encrypted: the server administrator sets{" "}
              <span className="font-mono">CREDENTIALS_ENCRYPTION_KEY</span> first.
            </p>
          )}
        </CardContent>
      )}
      {editing && (
        <SsoSheet
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          save={(input) => (editing === "new" ? create(input) : update(editing.id, input))}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function SsoSheet({
  row,
  onClose,
  save,
  onSaved,
}: {
  row: SsoRow | null;
  onClose: () => void;
  save: Action;
  onSaved: () => void;
}) {
  const [protocol, setProtocol] = useState<Protocol>(row?.protocol ?? "OIDC");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    startTransition(async () => {
      setError(null);
      const res = await save({ ...form, protocol, enforced: form.enforced === "on" });
      if (res.ok) onSaved();
      else setError(res.error);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={row ? `Edit ${row.name}` : "Add single sign-on"}
        description="People of one email domain sign in with your identity provider; their directory groups decide their role here."
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm">
            {!row && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-protocol">Protocol</Label>
                <Select
                  id="sso-protocol"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as Protocol)}
                >
                  <option value="OIDC">OpenID Connect (Entra ID, Okta, Keycloak, Google…)</option>
                  <option value="SAML">SAML 2.0 (ADFS, Shibboleth, Entra ID…)</option>
                  <option value="LDAP">LDAP / Active Directory</option>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-name">Name</Label>
                <Input
                  id="sso-name"
                  name="name"
                  defaultValue={row?.name}
                  placeholder="University login"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-domain">Email domain</Label>
                <Input
                  id="sso-domain"
                  name="domain"
                  defaultValue={row?.domain}
                  readOnly={!!row}
                  placeholder="uni.example"
                  className="font-mono"
                  required
                />
              </div>
            </div>
            {protocol === "OIDC" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sso-issuer">Issuer URL</Label>
                  <Input
                    id="sso-issuer"
                    name="issuer"
                    defaultValue={row?.issuer ?? ""}
                    placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
                    className="font-mono"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sso-client">Client ID</Label>
                    <Input
                      id="sso-client"
                      name="clientId"
                      defaultValue={row?.clientId ?? ""}
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sso-secret">Client secret</Label>
                    <Input
                      id="sso-secret"
                      name="clientSecret"
                      type="password"
                      placeholder={row ? "Unchanged" : ""}
                      required={!row}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sso-scopes">Extra scopes (optional)</Label>
                  <Input
                    id="sso-scopes"
                    name="extraScopes"
                    placeholder="groups"
                    className="font-mono"
                  />
                </div>
                {row && (
                  <CopyBlock
                    label="Redirect URI for your provider"
                    value={row.details.redirectUri}
                  />
                )}
              </>
            ) : protocol === "LDAP" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sso-ldap-url">Directory server</Label>
                  <Input
                    id="sso-ldap-url"
                    name="url"
                    defaultValue={row?.ldap?.url ?? ""}
                    placeholder="ldaps://dc01.uni.example:636"
                    className="font-mono"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sso-ldap-bind">Service account DN</Label>
                    <Input
                      id="sso-ldap-bind"
                      name="bindDn"
                      defaultValue={row?.ldap?.bindDn ?? ""}
                      placeholder="cn=svc-inframole,ou=Service,dc=uni,dc=example"
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sso-ldap-password">Service account password</Label>
                    <Input
                      id="sso-ldap-password"
                      name="bindPassword"
                      type="password"
                      placeholder={row ? "Unchanged" : ""}
                      required={!row}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sso-ldap-base">Search base DN</Label>
                    <Input
                      id="sso-ldap-base"
                      name="baseDn"
                      defaultValue={row?.ldap?.baseDn ?? ""}
                      placeholder="dc=uni,dc=example"
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sso-ldap-filter">User filter</Label>
                    <Input
                      id="sso-ldap-filter"
                      name="userFilter"
                      defaultValue={row?.ldap?.userFilter ?? "(mail={email})"}
                      className="font-mono"
                      required
                    />
                  </div>
                </div>
                <p className="text-subtle text-xs">
                  A read-only service account is enough: InfraMole only searches and binds. The
                  password is stored encrypted; the passwords people type are never stored.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sso-metadata">Identity provider metadata (XML)</Label>
                  <Textarea
                    id="sso-metadata"
                    name="idpMetadata"
                    rows={6}
                    placeholder={
                      row ? "Unchanged — paste new metadata to replace it" : "<EntityDescriptor …>"
                    }
                    className="font-mono text-xs"
                    required={!row}
                  />
                </div>
                {row && (
                  <>
                    <CopyBlock label="Entity ID (audience)" value={row.details.entityId} />
                    <CopyBlock label="Reply URL (ACS)" value={row.details.acsUrl} />
                  </>
                )}
              </>
            )}
            {!row && (
              <p className="text-subtle text-xs">
                {protocol === "LDAP"
                  ? "Saving checks that the service account can sign in to the directory. "
                  : `After saving, this panel shows the ${protocol === "OIDC" ? "redirect URI" : "entity ID and reply URL"} to register in your identity provider. `}
                It also shows the DNS record that proves the domain.
              </p>
            )}
            <fieldset className="space-y-3">
              <legend className="text-subtle mb-2 text-[11px] font-medium tracking-wider uppercase">
                Who gets which role
              </legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-claim">Groups claim / attribute</Label>
                <Input
                  key={protocol}
                  id="sso-claim"
                  name="groupsClaim"
                  defaultValue={row?.groupsClaim ?? (protocol === "LDAP" ? "memberOf" : "groups")}
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-rules">Group rules (one per line)</Label>
                <Textarea
                  id="sso-rules"
                  name="groupRules"
                  rows={4}
                  defaultValue={row ? formatGroupRules(row.groupRules) : ""}
                  placeholder={"IT-Infrastructure = admin\nService-Desk = viewer"}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sso-default">People in no listed group</Label>
                <Select id="sso-default" name="defaultRole" defaultValue={row?.defaultRole ?? ""}>
                  <option value="">Refused</option>
                  <option value="VIEWER">Viewer</option>
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </Select>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  name="enforced"
                  defaultChecked={row?.enforced}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-medium">SSO only</span> — people of this domain cannot use a
                  password (applies once the domain is verified).
                </span>
              </label>
              <p className="text-subtle text-xs">
                Roles are applied at every sign-in: someone who leaves the mapped groups loses
                access. Owners are never changed, and no group can make someone an owner.
              </p>
            </fieldset>
          </div>
          <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
            <p role="alert" className="text-danger min-w-0 text-xs">
              {error ?? ""}
            </p>
            <div className="flex shrink-0 gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Checking…" : row ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}
