# Manage and remove the agent

## Check the status

:::tabs
@tab Windows
```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" status
Get-Service inframole-agent
```
@tab Linux
```sh
sudo inframole-agent status
systemctl status inframole-agent
```
:::

`status` shows the server, the agent id and whether the service is running.
In InfraMole, **Settings › Agents** lists every agent with its last report.

## Logs

:::tabs
@tab Windows
Event Viewer › **Windows Logs › Application**, source `inframole-agent`, or:

```powershell
Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "inframole-agent" } -MaxEvents 20
```
@tab Linux
```sh
journalctl -u inframole-agent -n 50 --no-pager
```
:::

## Run once in the foreground

Useful to see errors directly (stop the service first):

:::tabs
@tab Windows
```powershell
Stop-Service inframole-agent
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" run --once --config C:\ProgramData\InfraMole\agent.json
Start-Service inframole-agent
```
@tab Linux
```sh
sudo systemctl stop inframole-agent
sudo inframole-agent run --once
sudo systemctl start inframole-agent
```
:::

## Updates

Agent **0.4.0** and later can update themselves — only if you turn it on in
the agent's configuration (`/etc/inframole/agent.json` or
`C:\ProgramData\InfraMole\agent.json`):

```json
{ "autoUpdate": true }
```

About once a day the agent checks the
[official releases](https://github.com/InfraMole/agent/releases). It installs
a newer version only if the release is **signed with the InfraMole key built
into the agent** and the downloaded file matches it; it never goes back to
an older version. The InfraMole server cannot trigger an update or choose
where it comes from. The previous version is kept until the new one sends
its first report; if the new one cannot report after three starts, the
agent puts the previous version back on its own.

To update now (or only check), as Administrator / root:

:::tabs
@tab Windows
```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" update --check
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" update
```
@tab Linux
```sh
sudo inframole-agent update --check
sudo inframole-agent update
```
:::

Agents older than 0.4.0 update by running the install command again
(**Settings › Agents › New enrollment token**).

## Revoke an agent

In **Settings › Agents**, revoke the agent. Its reports are rejected
immediately; the host stays in the Library (it becomes **Stale** after three
missed intervals) with all its history. Revoking is also the right step
when a machine is lost or compromised.

An enrollment token can be revoked there too; agents already enrolled keep
working.

## Re-enroll

Running the install command again on the same machine re-enrolls it: the
same agent is reused (the machine is recognised by its machine id) and gets
a new credential. No duplicate host is created.

## Uninstall

:::tabs
@tab Windows
In PowerShell as Administrator:

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" uninstall
Remove-Item -Recurse "$env:ProgramFiles\InfraMole"
```
@tab Linux
```sh
sudo inframole-agent uninstall
sudo rm /usr/local/bin/inframole-agent
```
:::

`uninstall` stops and removes the service and deletes its configuration
(`--keep-config` keeps it). It does **not** revoke the agent on the server —
revoke it in **Settings › Agents** so its credential can never be used again.
