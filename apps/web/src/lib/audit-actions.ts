// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Audit action catalogue (M8c). Client-safe: the UI renders these labels.
 * Adding an action = add it here; `recordAudit` only accepts these keys.
 */
export const AUDIT_ACTIONS = {
  "workspace.created": { group: "workspace", label: "created the workspace" },
  "workspace.exported": { group: "workspace", label: "exported the workspace data" },
  "workspace.deleted": { group: "workspace", label: "deleted the workspace" },
  "workspace.source_retired": { group: "workspace", label: "retired the resources of" },
  "workspace.settings_changed": {
    group: "workspace",
    label: "changed workspace security settings",
  },
  "member.invited": { group: "members", label: "invited" },
  "member.invitation_revoked": { group: "members", label: "revoked the invitation for" },
  "member.joined": { group: "members", label: "joined the workspace" },
  "member.role_changed": { group: "members", label: "changed the role of" },
  "member.removed": { group: "members", label: "removed" },
  "member.left": { group: "members", label: "left the workspace" },
  "integration.created": { group: "integrations", label: "added the integration" },
  "integration.deleted": { group: "integrations", label: "deleted the integration" },
  "integration.synced": { group: "integrations", label: "ran a manual sync of" },
  "agent.token_created": { group: "agents", label: "created the enrollment token" },
  "agent.token_revoked": { group: "agents", label: "revoked the enrollment token" },
  "agent.enrolled": { group: "agents", label: "enrolled" },
  "agent.revoked": { group: "agents", label: "revoked the agent" },
  "auth.sign_in": { group: "account", label: "signed in" },
  "auth.password_reset": { group: "account", label: "reset the password" },
  "auth.two_factor_enabled": { group: "account", label: "enabled two-factor authentication" },
  "auth.two_factor_disabled": { group: "account", label: "disabled two-factor authentication" },
  "auth.passkey_added": { group: "account", label: "added a passkey" },
  "auth.passkey_removed": { group: "account", label: "removed a passkey" },
  "auth.sign_in_method_added": { group: "account", label: "connected a sign-in method" },
  "auth.account_deleted": { group: "account", label: "deleted the account" },
  "billing.plan_changed": { group: "billing", label: "changed the plan" },
  "operator.db_access": { group: "platform", label: "opened a database session" },
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export type AuditGroup = (typeof AUDIT_ACTIONS)[AuditAction]["group"];

export const AUDIT_GROUPS: { value: AuditGroup; label: string }[] = [
  { value: "members", label: "Members" },
  { value: "integrations", label: "Integrations" },
  { value: "agents", label: "Agents" },
  { value: "workspace", label: "Workspace" },
  { value: "billing", label: "Billing" },
];

export function actionsInGroup(group: AuditGroup): AuditAction[] {
  return (Object.keys(AUDIT_ACTIONS) as AuditAction[]).filter(
    (a) => AUDIT_ACTIONS[a].group === group,
  );
}
