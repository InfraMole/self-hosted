# Self-hosting InfraMole

> Full documentation, with step-by-step guides for Linux, Windows and macOS:
> **https://inframole.com/docs**. This file is the short version.

InfraMole **Community** is free and open source (AGPL-3.0-only): unlimited
servers and VMs, one workspace, on your own server. Your data never leaves it. With Docker, installing takes
about ten minutes.

## What you need

- A Linux server (x86-64 or ARM64) with **Docker Engine 24+** and the
  **Compose v2** plugin. 2 GB RAM and 10 GB of disk are plenty for a few
  hundred servers.
- A **DNS name** (for example `inframole.example.com`) pointing at the server,
  and ports **80 and 443** reachable from the internet, so a free Let's
  Encrypt certificate can be issued. For a trial on a private network see
  _Local trial_ at the end.
- Optional: an SMTP account for email (verification, password reset,
  invitations).

Only ports 80 and 443 are published. The database and the application are
never exposed.

## 1. Download

```sh
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
sha256sum -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz
cd inframole-self-hosted
```

The folder contains `docker-compose.yml`, the web server configuration
(`Caddyfile`), `.env.example`, helper scripts and this guide. The images come
from `ghcr.io/inframole`.

## 2. Configure

```sh
cp .env.example .env
./scripts/gen-secrets.sh .env     # fills every empty password and key
                                  # Windows: powershell -ExecutionPolicy Bypass -File .\scripts\gen-secrets.ps1 .env
nano .env                         # or any editor
```

In `.env`, set at least:

| Setting                 | Value                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPMAP_DOMAIN`         | Your DNS name, e.g. `inframole.example.com` (no `https://`)                                                                                                             |
| `SMTP_URL`, `MAIL_FROM` | Recommended: e.g. `smtps://user:password@smtp.example.com:465` and `InfraMole <inframole@example.com>`. Without them, emails are not sent and email verification is off |
| `BACKUP_AGE_RECIPIENT`  | Recommended: an [age](https://age-encryption.org) public key, so nightly backups are encrypted                                                                          |

Leave `EDITION=community`. Everything else is optional and explained in the
file itself.

**Keep a copy of `.env` somewhere safe** (a password manager). Without
`CREDENTIALS_ENCRYPTION_KEY`, stored integration credentials cannot be
decrypted, and without the database passwords a restore is harder.

## 3. Start

```sh
docker compose up -d
docker compose ps
```

The first start downloads the images, applies the database migrations and
requests the TLS certificate. After a minute:

```sh
curl https://inframole.example.com/api/health    # {"status":"ok"}
```

## 4. Create your account

Open `https://<your domain>/sign-up`, create the first account and then the
workspace. You are its **owner**. Invite your team from **Settings ›
Members**; each person gets a role (viewer, member, admin, owner).

Sign-up stays open to anyone who can reach the address. Community allows one
workspace, so strangers cannot create their own or see yours, but if the
instance is for internal use, keep it behind your VPN or firewall.

## 5. Add your infrastructure

Pick any combination:

- **Agents**: Settings › Agents › _New enrollment token_ shows the install
  command for Windows and Linux. The agent is read-only and only needs
  outbound HTTPS to your domain. See
  [what the agent collects](https://inframole.com/agent).
- **Cloud integrations**: Settings › Integrations (Azure, AWS, Cloudflare)
  with read-only tokens, encrypted at rest.
- **Files**: Library › Import (CSV, docker-compose, Proxmox / Azure / AWS /
  Cloudflare exports).

Detected relationships appear under **Suggestions** until someone confirms
them.

## 6. Backups

The `backup` service writes a database dump every night to `./backups` and
keeps 14 days (`BACKUP_KEEP_DAYS`). With `BACKUP_AGE_RECIPIENT` set, dumps
are encrypted before they touch the disk. **Copy `./backups` to another
machine** (rsync, restic, your NAS…): a backup on the same disk does not
protect against losing the server.

Restore (stops the app, replaces the database, starts it again):

```sh
./scripts/restore.sh depmap-20261001T020000Z.dump
./scripts/restore.sh depmap-20261001T020000Z.dump.age /secure/path/age-key.txt   # encrypted
```

## 7. Updates

Back up first, then download the new bundle over the existing folder (your
`.env` and `backups/` are not in the bundle, so they are kept) and restart:

```sh
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
tar xzf inframole-self-hosted.tar.gz -C ..
docker compose pull
docker compose up -d
```

Migrations run automatically before the new version starts. Release notes:
[github.com/InfraMole/self-hosted/releases](https://github.com/InfraMole/self-hosted/releases).

## Optional settings

- **Google / Microsoft sign-in**: set `GOOGLE_*` or `MICROSOFT_*` in `.env`
  and register the redirect URI `https://<your domain>/api/auth/callback/google`
  (or `/microsoft`).
- **Scheduled integration sync and data retention**: on by default through
  `CRON_SECRET` (filled by `gen-secrets.sh`).
- **Several workspaces, priority support or a commercial licence**: a Business licence
  (`DEPMAP_LICENSE_KEY`, verified offline, no phone-home). Contact
  [sales@inframole.com](mailto:sales@inframole.com).

## Local trial without a public name

Set `DEPMAP_DOMAIN=localhost` and `CADDY_TLS=tls internal` in `.env`. Caddy
then uses its own certificate authority; your browser will warn once. Use
this only for evaluation.

## Troubleshooting

| Symptom                  | Check                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| The site does not load   | `docker compose ps` — every service should be `running`/`healthy`; `docker compose logs web`      |
| Certificate errors       | The DNS name must point at this server and ports 80/443 must be open: `docker compose logs caddy` |
| Emails do not arrive     | `docker compose logs web \| grep mail` and the SMTP settings                                      |
| An agent does not appear | On the host: `inframole-agent status`; the host must reach `https://<your domain>`                |

## Uninstall

```sh
docker compose down        # stops everything, keeps the data
docker compose down -v     # also deletes the database and certificates — irreversible
```
