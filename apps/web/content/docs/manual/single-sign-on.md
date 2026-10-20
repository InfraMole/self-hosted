# Single sign-on

Let the people of your organization sign in with your own identity provider
or directory. Their directory groups decide their role in the workspace, at
every sign-in.

Supported:

- **OpenID Connect** — Microsoft Entra ID, Okta, Keycloak, Google Workspace,
  Authentik, Zitadel…
- **SAML 2.0** — ADFS, Shibboleth, Entra ID, Okta, Keycloak…
- **LDAP / Active Directory** — the directory checks the password.

Single sign-on is available in every edition. Only workspace **owners** can
set it up; admins can see it.

## How it works

1. A connection is for **one email domain** (for example `uni.example`).
2. You prove that you own the domain with a DNS record. Until then, nobody
   can sign in with the connection.
3. People of that domain click **Sign in with SSO** on the sign-in page and
   enter their work email. InfraMole sends them to your provider (or asks
   for their directory password with LDAP).
4. At every sign-in, their groups are matched against your rules:
   - the highest matching role wins (viewer, member or admin);
   - people in no listed group get the default role you chose, or are
     refused;
   - someone who leaves the groups loses access at their next sign-in.

A directory never makes someone an **owner**, and existing owners are never
changed or removed by a sign-in. Accounts are created at the first sign-in;
there is no need to invite people.

## Add a connection

**Settings › Single sign-on › Add single sign-on**, choose the protocol, a
name and the email domain.

### OpenID Connect

1. In your provider, create a web application (confidential client) with the
   **redirect URI** InfraMole shows after saving:
   `https://<your InfraMole>/api/auth/sso/callback/<id>`. You can save first
   and add the redirect URI right after.
2. In InfraMole enter the **issuer URL** (for Entra ID
   `https://login.microsoftonline.com/<tenant-id>/v2.0`; for Keycloak
   `https://<host>/realms/<realm>`), the **client ID** and the **client
   secret**. InfraMole reads the provider's discovery document when you save.
3. Make the provider send the groups in the ID token or user info, in the
   claim named in **Groups claim** (default `groups`). Some providers need
   an extra scope (Okta: `groups`).

### SAML 2.0

1. Paste your provider's **metadata XML** in InfraMole and save.
2. Open **Settings for your identity provider** on the connection and
   register in your provider: the **Entity ID** (audience), the **Reply URL
   (ACS)**, or simply the **service provider metadata** URL. InfraMole signs
   its requests; if your provider asks for the signing certificate, copy it
   from there.
3. Send the email address as NameID (format email) or in an attribute named
   `email`, and the groups in an attribute (default `groups`; ADFS often uses
   `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`).
   Assertions must be signed.

### LDAP / Active Directory

Needs `CREDENTIALS_ENCRYPTION_KEY` on the server (the service account's
password is stored encrypted).

- **Directory server**: `ldaps://dc01.uni.example:636`. Plain `ldap://` and
  servers on a private network are only allowed when the server
  administrator lists them in `SSO_TRUSTED_ORIGINS` (self-hosted).
- **Service account DN** and **password**: a read-only account that can
  search users and groups.
- **Search base DN**: for example `dc=uni,dc=example`.
- **User filter**: how to find a person by email. Default `(mail={email})`;
  for Active Directory, `(userPrincipalName={email})` is common.
- **Groups attribute**: `memberOf` (Active Directory). Directories without
  `memberOf` work too: InfraMole then looks for groups whose `member` is
  the person.

Saving checks that the service account can sign in and search. InfraMole
only searches and binds; it never stores the passwords people type.

With a private certificate authority, give the server the CA with
`NODE_EXTRA_CA_CERTS`.

## Group rules

One rule per line, `group = role`:

```text
IT-Infrastructure = admin
Engineers = member
Service-Desk = viewer
```

Group names are compared without case. Distinguished names
(`CN=IT-Infrastructure,OU=Groups,…`) match by their first part, and
Keycloak paths (`/IT/Infrastructure`) by their last segment.

## Prove the domain

After saving, the connection shows a DNS **TXT** record:

- **Name**: `_inframole-sso.<your domain>`
- **Value**: a code unique to the connection

Add it at your DNS provider, wait a few minutes and click **Verify
domain**. A domain can be connected to only one workspace. Self-hosted
installations can skip the DNS step for domains listed by the server
administrator in `SSO_TRUSTED_DOMAINS`.

## SSO only

Tick **SSO only** to stop people of the domain from using a password:
sign-in with a password, sign-up and password reset are refused for that
domain, and the sign-in page sends them to single sign-on. Other domains
are not affected. Keep at least one owner who can still sign in (for
example with an address of another domain) in case the provider is down.

## Good to know

- Two-factor authentication is handled by your identity provider for
  single sign-on.
- Disabling a connection stops its sign-ins at once; deleting it does not
  delete the accounts (people keep any other sign-in method they set up).
- Every change to connections and every role a sign-in grants or removes is
  in the audit log.
- Not included: automatic provisioning (SCIM), sign-in started from the
  provider (IdP-initiated SAML) and single logout.

## Server settings (self-hosted)

| Variable              | Purpose                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `SSO_TRUSTED_DOMAINS` | Comma-separated email domains you vouch for: no DNS proof needed.                                        |
| `SSO_TRUSTED_ORIGINS` | Providers or directories on your network or without TLS, e.g. `https://idp.corp.lan,ldap://dc01.lan:389` |
