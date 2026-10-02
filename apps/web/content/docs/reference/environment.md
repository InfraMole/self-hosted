# Environment variables

Settings for self-hosted installations, in `.env` next to
`docker-compose.yml`. Apply changes with `docker compose up -d`.

## Required

| Variable             | Description                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPMAP_DOMAIN`      | Public DNS name of the server, without `https://`.                                                                                                                                                    |
| `POSTGRES_PASSWORD`  | Database owner password (migrations, backups). Filled by `gen-secrets`.                                                                                                                               |
| `APP_DB_PASSWORD`    | Password of the restricted runtime database role used by the app. Filled by `gen-secrets`.                                                                                                            |
| `BETTER_AUTH_SECRET` | Signs sessions and encrypts two-factor secrets. Filled by `gen-secrets`. **Do not change it** once users have enabled 2FA: their authenticator codes would stop working (and everyone is signed out). |
| `CRON_SECRET`        | Enables scheduled integration syncs and data retention. Filled by `gen-secrets`.                                                                                                                      |

## Recommended

| Variable                     | Description                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_URL`                   | Outgoing email, e.g. `smtps://user:password@smtp.example.com:465`. When set, email verification is required.                                   |
| `MAIL_FROM`                  | Sender, e.g. `InfraMole <inframole@example.com>`. Required with `SMTP_URL`.                                                                    |
| `CREDENTIALS_ENCRYPTION_KEY` | Encrypts stored integration tokens (AES-256-GCM). Filled by `gen-secrets`. **Back it up**: without it stored tokens must be entered again.     |
| `BACKUP_AGE_RECIPIENT`       | age public key (`age1…`) to encrypt nightly backups.                                                                                           |
| `AGENT_DOWNLOAD_BASE_URL`    | Where the install commands download the agent. Default: the official releases (`https://github.com/InfraMole/agent/releases/latest/download`). |

## Optional

| Variable                                                         | Default               | Description                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EDITION`                                                        | `community`           | `community` or `business`.                                                                                                                                                                                                      |
| `DEPMAP_LICENSE_KEY`                                             | —                     | Business licence key (`dml1.…`), verified offline.                                                                                                                                                                              |
| `DEPMAP_REDIRECT_HOSTS`                                          | —                     | Extra names (space-separated) redirected to `DEPMAP_DOMAIN`, e.g. `www.inframole.example.com`.                                                                                                                                  |
| `CADDY_TLS`                                                      | empty (Let's Encrypt) | `tls internal` for a local trial with Caddy's own certificate authority.                                                                                                                                                        |
| `HTTP_PORT`, `HTTPS_PORT`                                        | `80`, `443`           | Host ports. Let's Encrypt needs 80/443.                                                                                                                                                                                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                       | —                     | Sign in with Google.                                                                                                                                                                                                            |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                 | —                     | Sign in with Microsoft.                                                                                                                                                                                                         |
| `MICROSOFT_TENANT_ID`                                            | `organizations`       | `organizations`, `common` or your tenant id.                                                                                                                                                                                    |
| `FEEDBACK_EMAIL`                                                 | —                     | Shows a Feedback button; messages are emailed here (needs SMTP).                                                                                                                                                                |
| `SIGNUP`                                                         | `open`                | `closed` makes the installation invite-only: only the first account and people you invite can sign up.                                                                                                                          |
| `INTEGRATIONS_PRIVATE_NETWORKS`                                  | —                     | Private networks the Proxmox, TrueNAS and Synology integrations may reach, e.g. `192.168.1.0/24,10.0.10.0/24` ([Local sources](/docs/manual/integrations#local-sources)). Loopback and link-local addresses are always refused. |
| `CRON_EVERY_SECONDS`                                             | `900`                 | How often scheduled jobs run.                                                                                                                                                                                                   |
| `BACKUP_KEEP_DAYS`                                               | `14`                  | Days of nightly backups kept in `./backups`.                                                                                                                                                                                    |
| `INFRAMOLE_VERSION`                                              | the bundle's version  | Image tag to run. Change it to update or roll back.                                                                                                                                                                             |
| `CREDENTIALS_KEY_VERSION`, `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS` | `1`, —                | Only while rotating the credentials key.                                                                                                                                                                                        |

## Rotating the credentials key

1. Move the current key to `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`.
2. Put a new key in `CREDENTIALS_ENCRYPTION_KEY` (`openssl rand -base64 32`)
   and increase `CREDENTIALS_KEY_VERSION`.
3. `docker compose up -d`. Each integration is re-encrypted with the new key
   on its next sync.
4. When every integration has synced once, remove
   `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`.
