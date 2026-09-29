# Install on Windows

InfraMole runs on Windows 10 and 11 through **Docker Desktop** with the WSL 2
backend. This is a good fit for evaluation and small teams. For a production
server that must run unattended, prefer Linux (a Linux VM on Hyper-V is
fine — see [Windows Server](#windows-server)).

:::note Docker Desktop licence
Docker Desktop is free for personal use, education and small businesses
(fewer than 250 employees and less than 10 million USD revenue). Larger
organisations need a paid Docker subscription.
:::

:::steps

### Install Docker Desktop

1. Enable virtualisation in the BIOS/UEFI if it is not already on.
2. Open **PowerShell as Administrator** and install WSL 2:

   ```powershell
   wsl --install
   ```

   Restart when asked.

3. Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and keep **Use WSL 2 based engine** selected.
4. In Docker Desktop › **Settings › General**, enable **Start Docker Desktop
   when you sign in**.
5. Check it in a new PowerShell window:

   ```powershell
   docker compose version
   ```

### Free ports 80 and 443

Caddy needs ports 80 and 443 for HTTPS. On Windows they are often taken by
**IIS** or another web server. Check:

```powershell
Get-NetTCPConnection -LocalPort 80,443 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess, @{n="Process";e={(Get-Process -Id $_.OwningProcess).Name}}
```

No output means they are free. If IIS uses them, install InfraMole on another
machine, or stop the IIS site bindings on 80/443.

### Open the firewall

In PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName "InfraMole HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "InfraMole HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Your router or cloud firewall must also forward 80/443 to this machine, and
your DNS name must point at its public address.

### Download InfraMole

```powershell
New-Item -ItemType Directory -Force C:\InfraMole | Out-Null
Set-Location C:\InfraMole
$base = "https://github.com/InfraMole/self-hosted/releases/latest/download"
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz" -OutFile inframole-self-hosted.tar.gz
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz.sha256" -OutFile inframole-self-hosted.tar.gz.sha256
$expected = (Get-Content .\inframole-self-hosted.tar.gz.sha256).Split(" ")[0]
if ((Get-FileHash .\inframole-self-hosted.tar.gz -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch: do not use this file." }
tar -xzf inframole-self-hosted.tar.gz --strip-components=1
```

`tar` is built into Windows 10 and 11. The folder now contains
`docker-compose.yml`, `Caddyfile`, `.env.example` and `scripts\`.

### Configure

```powershell
Copy-Item .env.example .env
powershell -ExecutionPolicy Bypass -File .\scripts\gen-secrets.ps1 .env
notepad .env
```

`gen-secrets.ps1` fills every empty password and key. In Notepad set at least
`DEPMAP_DOMAIN` (your DNS name, without `https://`) and save. Email
(`SMTP_URL`, `MAIL_FROM`) and encrypted backups (`BACKUP_AGE_RECIPIENT`) are
recommended — see [Configuration](/docs/installation/configuration).

:::warning Keep a copy of .env
Store `.env` in your password manager. Without `CREDENTIALS_ENCRYPTION_KEY`
stored integration credentials cannot be decrypted.
:::

### Start

```powershell
docker compose up -d
docker compose ps
```

The first start downloads the images, applies the database migrations and
requests the certificate. After about a minute every service should be
`running` (web: `healthy`).

### Check it works

```powershell
Invoke-RestMethod https://inframole.example.com/api/health
```

The answer shows `status: ok`. Then open `https://<your domain>/sign-up`,
create the first account and your workspace.

:::

:::note Docker Desktop and reboots
Containers restart automatically, but only once Docker Desktop is running —
which on Windows 10/11 happens when a user signs in. For a server that must
survive reboots without anyone logging in, use Linux.
:::

## Windows Server

Docker Desktop is not supported on Windows Server. Create a small Linux VM
instead (Hyper-V: **New › Quick Create**, or any Ubuntu Server ISO), give it
2 GB RAM and 20 GB disk, and follow [Install on Linux](/docs/installation/linux).
The Windows machines themselves are covered by the
[Windows agent](/docs/agent/install).

## Running the helper scripts

`restore.sh` and `db-shell.sh` are shell scripts. On Windows run them from
**WSL** (open _Ubuntu_ from the Start menu, `cd /mnt/c/InfraMole`) or **Git
Bash** — Docker Desktop makes `docker` available in both. Backups and restore
are described in [Backup and restore](/docs/operations/backups).
