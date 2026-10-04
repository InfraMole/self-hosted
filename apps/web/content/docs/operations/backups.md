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

A backup on the same disk does not survive the loss of the server. The
backup service can upload every **encrypted** dump to S3-compatible object
storage (AWS S3, Backblaze B2, Wasabi, Scaleway, OVHcloud, Cloudflare R2,
your own MinIO or Garage…) and delete the copies older than
`BACKUP_KEEP_DAYS` there too. Create a bucket and a key that can only read
and write that bucket, then add to `.env`:

```sh
BACKUP_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
BACKUP_S3_REGION=eu-central-003       # if your provider needs one
BACKUP_S3_BUCKET=inframole-backups
BACKUP_S3_PREFIX=prod                 # optional folder
BACKUP_S3_ACCESS_KEY_ID=…
BACKUP_S3_SECRET_ACCESS_KEY=…
```

and `docker compose up -d`. The log of the `backup` service says
`uploaded … to …` after each dump. **Uploads need `BACKUP_AGE_RECIPIENT`**:
InfraMole never sends an unencrypted dump off the server.

To restore from the bucket, download the `.dump.age` file you need into
`./backups` (with your provider's console or `rclone copy`) and follow
[Restore](#restore).

You can also copy `./backups` yourself — `rsync` to another machine,
`restic`, or your NAS.

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
