# Hypervisors: vCenter, Hyper-V and XCP-ng

An agent can also report the **hosts and virtual machines** of a
hypervisor, and which host runs each VM:

- **VMware vCenter or ESXi**, with a read-only vSphere user;
- **Hyper-V**, the VMs of the Windows host where the agent runs;
- **XCP-ng**, through **Xen Orchestra** with the token of a user that can
  only view.

These platforms live on your internal network, so it is the agent — not
the InfraMole server — that calls them. Credentials stay in files on that
machine: the server cannot enable a collector, change its address or read
its credentials.

What is kept for each host: name, cluster or pool, connection state and
version. For each VM: name, host, power state, vCPUs, memory, guest OS,
guest host name and guest IP addresses. Disks, snapshots, networks,
consoles and everything else are never read.

:::note Preview
The vCenter collector is verified against VMware's vSphere simulator
(`vcsim`), which implements the same API; Hyper-V and Xen Orchestra are
built from their documentation. None has been checked against a production
system yet: run the dry-run below first, and tell us if something looks
wrong. Needs agent 0.5.0 or later.
:::

:::steps

### Create a read-only account

:::tabs
@tab vCenter / ESXi

**vCenter** (vSphere Client):

1. **Administration › Single Sign On › Users and Groups › Users › Add**:
   user `inframole` in `vsphere.local`.
2. **Administration › Access Control › Global Permissions › Add**: that
   user, role **Read-only**, with **Propagate to children** checked.

**Standalone ESXi** (Host Client): **Manage › Security & users › Users ›
Add user**, then **Host › Actions › Permissions › Add user** with the role
**Read-only**.
@tab Hyper-V

Nothing to create: the agent service runs as Local System, which can read
Hyper-V. The Hyper-V PowerShell module must be installed on the host
(it comes with the Hyper-V management tools; on Windows Server:
`Install-WindowsFeature Hyper-V-PowerShell`).
@tab Xen Orchestra

1. In Xen Orchestra: **Settings › Users › Create**: a user with permission
   **User** (not Admin).
2. **Settings › ACLs**: give that user the role **Viewer** on your pools.
3. Sign in as that user and create a token, for example with
   `xo-cli create-token https://xo.lan inframole@corp.local`.

Tokens expire (Xen Orchestra's `maxTokenValidity`): create a new one before
that date.
:::

### Save the secret on the agent host

The file holds only the secret, on one line: the vCenter password or the
Xen Orchestra token. Hyper-V needs no file.

:::tabs
@tab Linux

```sh
sudo sh -c 'umask 077; cat > /etc/inframole/vcenter.password'
# paste the password, press Enter, then Ctrl+D
```

The agent refuses a file that other users can read.

@tab Windows

```powershell
Set-Content C:\ProgramData\InfraMole\vcenter.password '<password>'
icacls C:\ProgramData\InfraMole\vcenter.password /inheritance:r /grant:r SYSTEM:F Administrators:F
```

:::

### Enable the collector

Add a `collectors` section to the agent's configuration file
(`/etc/inframole/agent.json` or `C:\ProgramData\InfraMole\agent.json`),
next to the existing keys. Use only the ones you need:

```json
{
  "collectors": {
    "vcenter": {
      "url": "https://vcenter.corp.local",
      "username": "inframole@vsphere.local",
      "passwordFile": "/etc/inframole/vcenter.password",
      "caFile": "/etc/inframole/vcenter-ca.pem"
    },
    "xenOrchestra": {
      "url": "https://xo.corp.local",
      "tokenFile": "/etc/inframole/xo.token"
    },
    "hyperv": {}
  }
}
```

- `caFile`: the CA that signed the server's certificate (for vCenter,
  download it from `https://vcenter/certs/download.zip`).
- `intervalSec` (optional, in each collector): how often it runs — default
  3600, between 300 and 86400.
- `"hyperv": {}` only works on Windows.

### Test, then restart the service

```sh
sudo inframole-agent dry-run --inventory --window 2s
```

The output ends with a `hypervisors` section: the hosts and VMs the agent
would send. If it looks right, restart the service
(`sudo systemctl restart inframole-agent` or
`Restart-Service inframole-agent`).

:::

In InfraMole the hosts appear as servers and the VMs as virtual machines,
both **Discovered**, with a confirmed **hosts** relationship from each host
to its VMs. Hyper-V VMs hang from the machine that runs the agent. A VM
that runs its own agent is recognised as the same machine — by its name or
its guest host name — instead of appearing twice. Templates are skipped.

When a VM disappears from the hypervisor it becomes **Stale** after the
next successful collection — nothing is deleted.

:::note Self-signed labs
For a lab without a proper CA you can add `"insecureSkipVerify": true` to
the vCenter or Xen Orchestra collector. It can only be set locally, and you
should not use it in production.
:::
