# Backup and restore

## What is backed up

The `backup` service dumps the whole database every night to `./backups`
(next to `docker-compose.yml`) as `depmap-<date>.dump`, and deletes dumps
older than `BACKUP_KEEP_DAYS` (14 by default). The database holds
everything: accounts, workspaces, resources, relationships, history and
encrypted integration credentials.

Two things are **not** in the dump and must be kept separately:

- **`.env`** — the passwords and keys. Without `CREDENTIALS_ENCRYPTION_KEY`
  the integration credentials in a backup cannot be decrypted, and without
  `BETTER_AUTH_SECRET` two-factor authentication stops working.
- The age **private key**, if you encrypt backups.

## Encrypt the backups

:::steps

### Create a key pair on another machine

Install [age](https://age-encryption.org) on your workstation (not on the
server) and run:

```sh
age-keygen -o inframole-backup-key.txt
```

It prints the public key (`age1…`). Keep `inframole-backup-key.txt` in your
password manager or offline.

### Configure the server

In `.env`:

```sh
BACKUP_AGE_RECIPIENT=age1...
```

Then `docker compose up -d`. From the next night on, dumps are written as
`depmap-<date>.dump.age`, encrypted before they touch the disk.

:::

## Copy backups off the server

A backup on the same disk does not survive the loss of the server. Copy
`./backups` elsewhere every day, for example with `rsync` to another
machine, `restic` or `rclone` to object storage, or your NAS. Encrypted
dumps (`.age`) are safe to store with third parties.

## Take a backup now

```sh
docker compose exec backup sh -c 'pg_dump -h db -U depmap -d depmap -Fc > /backups/manual-$(date -u +%Y%m%dT%H%M%SZ).dump'
```

Do this before an upgrade.

## Restore

:::warning Restoring replaces the data
A restore replaces the whole database with the contents of the dump. Stop
and think about which dump you need; everything after it is lost.
:::

:::steps

### Put the dump in ./backups

Copy the file into the `backups` folder next to `docker-compose.yml`.

### Run the restore

:::tabs
@tab Linux / macOS

```sh
./scripts/restore.sh depmap-20261001T020000Z.dump
# encrypted:
./scripts/restore.sh depmap-20261001T020000Z.dump.age /secure/path/inframole-backup-key.txt
```

@tab Windows (WSL or Git Bash)

```sh
cd /mnt/c/InfraMole          # Git Bash: cd /c/InfraMole
./scripts/restore.sh depmap-20261001T020000Z.dump
```

:::

The script stops the app, restores the dump and starts the app again. The
private key is copied into the backup container only for the duration of
the restore.

### Check

Open InfraMole and verify the data. If you restored onto a new server, use
the same `.env` as the old one.

:::
