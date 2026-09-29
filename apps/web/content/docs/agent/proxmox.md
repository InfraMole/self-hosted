# Proxmox inventory

An agent installed next to a Proxmox VE cluster can also report its
**nodes, virtual machines and containers**, and which node hosts each of
them. It uses a read-only API token that **never leaves the machine**: the
server cannot enable this feature, change its URL or read the token.

What is kept: for each node, VM and LXC container its id, type, node,
name, VM id, status, memory size and template flag. Storage, pools, disks
and everything else in the API answer is dropped by the agent.

:::steps

### Create a read-only API token in Proxmox

In the Proxmox web UI:

1. **Datacenter › Permissions › Users › Add**: user `inframole@pve`.
2. **Datacenter › Permissions › API Tokens › Add**: user `inframole@pve`,
   token id `inventory`, keep **Privilege Separation** checked. Copy the
   secret shown once.
3. **Datacenter › Permissions › Add › API Token Permission**: path `/`,
   token `inframole@pve!inventory`, role **PVEAuditor** (read-only).

### Save the token on the agent host

The file holds one line: `USER@REALM!TOKENID=SECRET`.

:::tabs
@tab Linux
```sh
echo 'inframole@pve!inventory=<secret>' | sudo tee /etc/inframole/proxmox.token > /dev/null
sudo chmod 600 /etc/inframole/proxmox.token
# The node's CA, so the agent can verify the certificate:
sudo scp root@pve01:/etc/pve/pve-root-ca.pem /etc/inframole/pve-ca.pem
```

The agent refuses a token file that other users can read.
@tab Windows
```powershell
Set-Content C:\ProgramData\InfraMole\proxmox.token 'inframole@pve!inventory=<secret>'
icacls C:\ProgramData\InfraMole\proxmox.token /inheritance:r /grant:r SYSTEM:F Administrators:F
```

Copy `/etc/pve/pve-root-ca.pem` from a Proxmox node to
`C:\ProgramData\InfraMole\pve-ca.pem`.
:::

### Enable the collector

Edit the agent's configuration file (`/etc/inframole/agent.json` or
`C:\ProgramData\InfraMole\agent.json`) and add a `collectors` section next
to the existing keys:

```json
{
  "collectors": {
    "proxmox": {
      "url": "https://pve01.lan:8006",
      "tokenFile": "/etc/inframole/proxmox.token",
      "caFile": "/etc/inframole/pve-ca.pem",
      "intervalSec": 3600
    }
  }
}
```

`intervalSec` is how often the inventory is collected (default 3600, between
300 and 86400).

### Test, then restart the service

```sh
sudo inframole-agent dry-run --inventory --window 2s
```

The output shows the inventory the agent would send. If it looks right,
restart the service (`sudo systemctl restart inframole-agent` or
`Restart-Service inframole-agent`).

:::

In InfraMole the nodes, VMs and containers appear as **Discovered**, with
confirmed *hosts* relationships from each node to its guests. A guest that
runs its own agent is matched to that host by name.

When a VM disappears from Proxmox it becomes **Stale** after the next
successful collection — nothing is deleted.

:::note Self-signed labs
For a lab without a proper CA you can add `"insecureSkipVerify": true` to
the collector. It can only be set locally, and you should not use it in
production.
:::
