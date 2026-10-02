# Deploy to many machines

Installing the agent by hand is fine for a few servers. For dozens or
hundreds, use the templates in the
[agent repository](https://github.com/InfraMole/agent/tree/main/deploy):

| Template                             | Use it with                              |
| ------------------------------------ | ---------------------------------------- |
| `windows/Install-InfraMoleAgent.ps1` | Group Policy, Intune, an RMM tool        |
| `linux/install-inframole-agent.sh`   | cloud-init, an RMM tool, a loop over ssh |
| `ansible/inframole-agent.yml`        | Ansible (Linux hosts)                    |

All of them are safe to run again and again:

- a machine that is already enrolled is **never enrolled twice**;
- a stopped service is started; a removed service is reinstalled with the
  credential the machine already has;
- the binary is checked against `SHA256SUMS` before it is ever run;
- the enrollment token goes through an environment variable, never on a
  command line other users could read.

## Before you start: the token

Create one enrollment token for the rollout in **Settings › Agents › New
enrollment token**:

- **Expires in**: long enough for the rollout (7 or 30 days).
- **Max agents**: the number of machines, plus a margin.
- **Revoke it** when the rollout is done. Agents already enrolled keep
  working — each one has its own credential.

A token placed in a Group Policy, an Intune script or a playbook can be read
by others (any domain user can read the scripts of a GPO). Someone who
copies it can only enroll more agents into your workspace until it expires
or is revoked — they cannot read anything, and what an agent reports only
appears as _Discovered_.

## Windows — Group Policy

:::steps

### Put the script where computers can read it

Copy `Install-InfraMoleAgent.ps1` to the policy's own folder (the **Show
Files…** button in the next step opens it) or to `\\<your-domain>\NETLOGON`.

### Add it as a startup script

In **Group Policy Management**, create a GPO and edit it: **Computer
Configuration › Policies › Windows Settings › Scripts (Startup/Shutdown) ›
Startup › PowerShell Scripts › Add**. Choose the script and set the
parameters:

```text
-Server https://inframole.example.com -EnrollmentToken dmp_enr_...
```

### Wait for the network at start-up

Enable **Computer Configuration › Policies › Administrative Templates ›
System › Logon › Always wait for the network at computer startup and
logon**, so the script can reach the server.

### Link the GPO

Link it to the organisational unit of the servers. They install the agent
at their next restart (or after `gpupdate /force` and a restart).

:::

The script runs as SYSTEM at every start-up and does nothing once the agent
is installed. It writes a short log to
`C:\ProgramData\InfraMole\deploy.log`.

## Windows — Intune

Intune platform scripts cannot take parameters, so fill them in the script:

:::steps

### Fill the two values

Open a copy of `Install-InfraMoleAgent.ps1` and set, near the top:

```powershell
$IntuneServer = "https://inframole.example.com"
$IntuneEnrollmentToken = "dmp_enr_..."
```

### Add a platform script

In the Intune admin center: **Devices › Scripts and remediations ›
Platform scripts › Add › Windows 10 and later**. Upload the script and set:

- **Run this script using the logged on credentials**: No (it runs as SYSTEM)
- **Enforce script signature check**: No (or sign it yourself)
- **Run script in 64 bit PowerShell Host**: **Yes** — otherwise the agent
  lands in `Program Files (x86)`

### Assign it

Assign it to a device group. Intune runs it once per device, and again if
you change the script.

:::

## Linux — Ansible

The playbook installs the agent, enrolls each host once and keeps the
service running. Keep the token in a vault:

```sh
ansible-vault create vault.yml      # inframole_enrollment_token: dmp_enr_...
ansible-playbook -i inventory.ini inframole-agent.yml \
  -e inframole_server=https://inframole.example.com \
  -e @vault.yml --ask-vault-pass
```

Run it again whenever you like: enrolled hosts are left alone (the token is
only needed for new ones). Variables:

| Variable                      | Default            | Meaning                                |
| ----------------------------- | ------------------ | -------------------------------------- |
| `inframole_server`            | —                  | Your InfraMole address (`https://…`)   |
| `inframole_enrollment_token`  | —                  | Needed only for hosts not enrolled yet |
| `inframole_agent_version`     | `latest`           | Or a release tag such as `v0.6.0`      |
| `inframole_download_base_url` | the public release | An internal mirror (see below)         |
| `inframole_hosts`             | `all`              | Which inventory group to target        |

Changing `inframole_agent_version` replaces the binary and restarts the
agent on every host — that is also how you roll back. If Ansible manages
versions, leave the agent's own automatic update off (the default).

## Linux — a script (cloud-init, RMM)

`install-inframole-agent.sh` does the same as the playbook, configured
through environment variables. In cloud-init, for example:

```yaml
runcmd:
  - curl -fsSL -o /tmp/install.sh https://raw.githubusercontent.com/InfraMole/agent/main/deploy/linux/install-inframole-agent.sh
  - INFRAMOLE_SERVER=https://inframole.example.com INFRAMOLE_ENROLLMENT_TOKEN=dmp_enr_... sh /tmp/install.sh
```

## Machines without internet access

Put the agent files of a release on an internal web server or a file share:
the four `inframole-agent_*` binaries and `SHA256SUMS` (verify its signature
once when you fill the mirror — see the
[agent releases](https://github.com/InfraMole/agent#releases-and-verification)).
Then point the templates to it:

| Template   | Setting                                                               |
| ---------- | --------------------------------------------------------------------- |
| PowerShell | `-DownloadBaseUrl \\fileserver\software\inframole-agent`              |
| Shell      | `INFRAMOLE_DOWNLOAD_BASE_URL=https://mirror.example.com/inframole`    |
| Ansible    | `-e inframole_download_base_url=https://mirror.example.com/inframole` |

## Check the rollout

New machines appear in **Settings › Agents** within a few minutes, and in
the Library as _Discovered_. On a machine, `inframole-agent status` shows
whether it is enrolled and the service is running.

To remove the agent from many machines, run `inframole-agent uninstall`
with the same tool, then revoke the agents in **Settings › Agents** (see
[Manage and remove](/docs/agent/manage)).
