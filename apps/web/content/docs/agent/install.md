# Install the agent

Install `inframole-agent` on each server you want to map. You need to be a
workspace **admin** or **owner** to create enrollment tokens.

:::steps

### Create an enrollment token

In InfraMole open **Settings › Agents › New enrollment token**. Give it a
name (for example `datacenter-1`), choose how long it is valid (7 days by
default) and, optionally, how many agents may use it.

The dialog then shows the token **once**, with ready-made install commands
for Windows and Linux. One token can enroll many servers.

### Check what would be sent (optional)

Before installing anything, you can download the binary (see
[Manual download](#manual-download)) and print the exact report it would
send. Nothing leaves the machine and nothing is installed:

:::tabs
@tab Windows
```powershell
.\inframole-agent.exe dry-run
```
@tab Linux
```sh
./inframole-agent dry-run
```
:::

### Download, verify and install

Run the commands from the dialog on the server. They put the binary in a
permanent location, **stop if the checksum does not match**, enroll the
machine and install the service. They look like this:

:::tabs
@tab Windows
Open **PowerShell as Administrator**:

```powershell
$dir = "$env:ProgramFiles\InfraMole"; New-Item -ItemType Directory -Force $dir | Out-Null
Set-Location $dir
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$file = "inframole-agent_windows_$arch.exe"
$base = "https://github.com/InfraMole/agent/releases/latest/download"
Invoke-WebRequest "$base/$file" -OutFile inframole-agent.exe
Invoke-WebRequest "$base/SHA256SUMS" -OutFile SHA256SUMS
$expected = Get-Content SHA256SUMS | ForEach-Object { $h, $n = $_ -split '\s+\*?', 2; if ($n -eq $file) { $h } }
if (-not $expected -or (Get-FileHash inframole-agent.exe -Algorithm SHA256).Hash -ne $expected) { Remove-Item inframole-agent.exe; throw "Checksum mismatch: do not run this file." }
$env:INFRAMOLE_ENROLLMENT_TOKEN = "<token from the dialog>"
& "$dir\inframole-agent.exe" install --server https://inframole.example.com
```

The binary lives in `C:\Program Files\InfraMole` and runs as the
**inframole-agent** Windows service (LocalSystem, automatic start). Its
configuration is in `C:\ProgramData\InfraMole\agent.json`, readable only by
SYSTEM and Administrators.
@tab Linux
With `sudo` (or as root):

```sh
cd "$(mktemp -d)"
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
BASE=https://github.com/InfraMole/agent/releases/latest/download
curl -fsSLO "$BASE/inframole-agent_linux_$ARCH" -O "$BASE/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS && sudo install -m 0755 "inframole-agent_linux_$ARCH" /usr/local/bin/inframole-agent
sudo INFRAMOLE_ENROLLMENT_TOKEN=<token from the dialog> /usr/local/bin/inframole-agent install --server https://inframole.example.com
```

The binary lives in `/usr/local/bin/inframole-agent` and runs as the
**inframole-agent** systemd unit (enabled, restarts automatically). Its
configuration is in `/etc/inframole/agent.json` (mode 0600).
:::

Passing the token through `INFRAMOLE_ENROLLMENT_TOKEN` keeps it out of the
shell history and process list.

### Confirm it is reporting

:::tabs
@tab Windows
```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" status
```
@tab Linux
```sh
sudo inframole-agent status
```
:::

Within a minute the server appears in **Settings › Agents** and in the
Library as **Discovered**. Connections become suggestions after a couple of
reports.

:::

:::tip Many servers
Use the same token everywhere (set **Max agents** if you want a cap), and
your usual tools — GPO, Intune, Ansible, SSH loops — to run the same commands.
The installation is idempotent: running it again on an enrolled machine
re-enrolls it without creating a duplicate host.
:::

## Manual download

Binaries for Windows and Linux (x64 and ARM64), `SHA256SUMS` and its
Sigstore signature are on the
[agent releases page](https://github.com/InfraMole/agent/releases). Verify
by hand with:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

## Firewalls and proxies

The agent only needs outbound HTTPS to your InfraMole address. It does not
follow redirects and always verifies the server certificate (TLS 1.2+).

Behind an HTTP proxy, it uses the standard `HTTPS_PROXY` and `NO_PROXY`
variables. Set them for the service:

:::tabs
@tab Windows
As Administrator, set a machine-wide variable and restart the service:

```powershell
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://proxy.example.com:3128", "Machine")
Restart-Service inframole-agent
```

If the service does not pick it up, restart Windows once.
@tab Linux
```sh
sudo systemctl edit inframole-agent
# add:
# [Service]
# Environment=HTTPS_PROXY=http://proxy.example.com:3128
sudo systemctl restart inframole-agent
```
:::
