# Members and security

## Roles

Each member of a workspace has one role:

| Capability                                                              | Viewer | Member | Admin | Owner |
| ----------------------------------------------------------------------- | :----: | :----: | :---: | :---: |
| Read the Library, map, impact and changes                               |   ✔    |   ✔    |   ✔   |   ✔   |
| Create and edit resources and relationships, review suggestions, import |        |   ✔    |   ✔   |   ✔   |
| Manage agents, enrollment tokens and integrations                       |        |        |   ✔   |   ✔   |
| Invite members, change roles, remove members (not owners)               |        |        |   ✔   |   ✔   |
| Grant or remove the owner role, billing, delete the workspace           |        |        |       |   ✔   |

A workspace always keeps at least one owner. Anyone can leave a workspace.

## Invite people

**Settings › Members › Invite**: enter the email address and the role. The
person receives an email (if email is configured) and the link is also shown
to you, valid for 7 days. They accept by signing in or creating an account
with that same address. Pending invitations can be revoked.

## Your account

**Account & security** (your name at the bottom of the sidebar) has:

- **Two-factor authentication** with any authenticator app (TOTP), plus
  single-use **backup codes** — store them safely.
- **Passkeys**: sign in with Windows Hello, Touch ID, a phone or a security
  key, without a password.
- **Sign-in methods**: connect Google or Microsoft (when the server has them
  enabled).
- **Recent security activity**: your sign-ins with time, IP and browser.
- **Delete account**: removes your user data and the workspaces where you
  are the only member. Refused while you are the only owner of a workspace
  that has other members — transfer ownership first.

## Require 2FA in a workspace

Owners can turn on **Require two-factor authentication for every member**
in **Settings**. Members without 2FA are asked to set it up before they can
open the workspace.

## Audit log

**Settings › Audit log** (admins and owners) records security-relevant
events: members invited, joined, removed or changed role; integrations
added, synced or deleted; agents enrolled or revoked; security, billing and
data settings. Each entry shows who, what, when and from which IP. Entries
cannot be edited or deleted and are kept for 365 days.

## Export and delete a workspace

- **Export workspace data (JSON)** in **Settings** (admins and owners)
  downloads resources, confirmed relationships, suggestions, members, agents,
  integrations (without credentials), changes and the audit log. The resources
  and relationships can be imported into another workspace. Secrets are never
  included.
- **Delete workspace** (owner only) removes all its data immediately. Export
  first if you may need it; it cannot be undone.
