# Configuration

All settings live in the `.env` file next to `docker-compose.yml`. After any
change, apply it with:

```sh
docker compose up -d
```

Only the services whose settings changed are recreated. The complete list is
in [Environment variables](/docs/reference/environment).

## Domain and HTTPS

`DEPMAP_DOMAIN` is the public name of your server, without `https://`.
Caddy obtains and renews a Let's Encrypt certificate for it automatically
and redirects HTTP to HTTPS.

To also answer on other names (for example `www.`), list them in
`DEPMAP_REDIRECT_HOSTS`, separated by spaces. Each needs a DNS record
pointing at the server; Caddy redirects them to `DEPMAP_DOMAIN`.

:::warning Changing the domain later
Passkeys are bound to the domain. If you move InfraMole to a different
domain, users must register their passkeys again (passwords and 2FA keep
working).
:::

## Email

Emails are used for address verification, password reset and invitations.

```sh
SMTP_URL=smtps://user:password@smtp.example.com:465
MAIL_FROM="InfraMole <inframole@example.com>"
```

Use `smtp://…:587` for STARTTLS. When email is configured, new accounts must
verify their address before signing in. Without it, emails are not sent and
invitation links are shown on screen for you to share.

## Encrypted backups

Nightly backups are written to `./backups`. To encrypt them before they
touch the disk, create an [age](https://age-encryption.org) key pair **on
another machine** and put only the public key in `.env`:

```sh
age-keygen -o inframole-backup-key.txt     # keep this file OFF the server
# Public key: age1…
```

```sh
BACKUP_AGE_RECIPIENT=age1...
```

See [Backup and restore](/docs/operations/backups).

## Sign in with Google or Microsoft

Optional. Create an OAuth app with the provider, register the redirect URI
and set the client id and secret:

| Provider             | Redirect URI                                        | Variables                                                               |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Google               | `https://<your domain>/api/auth/callback/google`    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                              |
| Microsoft (Entra ID) | `https://<your domain>/api/auth/callback/microsoft` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` |

`MICROSOFT_TENANT_ID=organizations` accepts work and school accounts only;
set your tenant id to restrict sign-in to your organisation.

## Agent downloads

The enrollment dialog shows commands that download the agent from the
[official releases](https://github.com/InfraMole/agent/releases), **verify its
checksum** and install it in one go. To use your own mirror, set
`AGENT_DOWNLOAD_BASE_URL` to its `…/latest/download` address.

## Ports

Caddy publishes ports 80 and 443. `HTTP_PORT` and `HTTPS_PORT` change the
host ports, but Let's Encrypt only works on 80/443 — other ports are for
setups with `CADDY_TLS=tls internal`.

## Local trial without a public name

For an evaluation on a laptop or a private network:

```sh
DEPMAP_DOMAIN=localhost
CADDY_TLS=tls internal
```

Caddy then issues certificates from its own authority. Browsers warn until
you trust it; agents on other machines will not trust it. Do not use this
for production.

## Invite-only sign-up

By default anyone who can reach your server can create an account. To make
the installation invite-only, create your own account first, then set:

```sh
SIGNUP=closed
```

and run `docker compose up -d`. From then on only people you invite from
**Settings › Members** can create an account (with the invited address). The
very first account of an installation can always be created.

## Business licence

Several workspaces, priority support or a commercial licence instead of the
AGPL are part of InfraMole Business.
Set it in `.env` and restart:

```sh
EDITION=business
DEPMAP_LICENSE_KEY=dml1....
```

The licence is verified offline — InfraMole never calls home. See
[Editions and limits](/docs/reference/editions).
