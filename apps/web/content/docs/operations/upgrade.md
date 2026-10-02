# Upgrade guide

InfraMole releases are published as a new bundle and new images. Upgrades
apply database migrations automatically before the new version starts.

:::steps

### Read the release notes

Check [the releases page](https://github.com/InfraMole/self-hosted/releases)
for anything that needs attention (for example a new setting).

### Back up

```sh
docker compose exec backup sh -c 'pg_dump -h db -U depmap -d depmap -Fc > /backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).dump'
```

### Download the new bundle

Your `.env` and `backups/` are not part of the bundle, so they are kept.

:::tabs
@tab Linux / macOS

```sh
cd /opt/inframole
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
sha256sum -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz --strip-components=1
```

@tab Windows

```powershell
Set-Location C:\InfraMole
$base = "https://github.com/InfraMole/self-hosted/releases/latest/download"
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz" -OutFile inframole-self-hosted.tar.gz
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz.sha256" -OutFile inframole-self-hosted.tar.gz.sha256
$expected = (Get-Content .\inframole-self-hosted.tar.gz.sha256).Split(" ")[0]
if ((Get-FileHash .\inframole-self-hosted.tar.gz -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch" }
tar -xzf inframole-self-hosted.tar.gz --strip-components=1
```

:::

Compare `.env.example` with your `.env` for new optional settings.

### Pull and restart

```sh
docker compose pull
docker compose up -d
docker compose ps
```

### Remove the old images

Every version downloads new images (about 700 MB) and the old ones stay on
disk until you remove them. After a few upgrades they can fill a small
server — the next `docker compose pull` then fails with _no space left on
device_. Once the new version is running:

```sh
docker image prune -af
```

This only removes images no container uses; the running version is kept.
`docker system df` shows how much space images take.

:::

If a pull fails with _no space left on device_, your current version keeps
running (`up -d` never ran): run `docker image prune -af`, then pull again.

## Pin or roll back a version

The bundle pins its images to its version. To run a specific version,
set it in `.env` and restart:

```sh
INFRAMOLE_VERSION=0.1.0
```

Rolling back to an older version after its database was migrated forward is
not supported: restore the backup taken before the upgrade instead (see
[Backup and restore](/docs/operations/backups)).

## Agents

Agents keep working across server upgrades. Agents 0.4.0 and later can
update themselves if you turn it on
([Manage and remove › Updates](/docs/agent/manage#updates)); older ones
update by running the install command again from **Settings › Agents › New
enrollment token** — the same machine is re-enrolled, no duplicate is
created.
