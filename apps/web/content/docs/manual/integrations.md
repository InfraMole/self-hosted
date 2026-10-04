# Integrations

Integrations keep InfraMole in sync with your providers using read-only API
credentials. They are managed by workspace admins and owners in
**Settings › Integrations**.

- **Clouds**: Azure, AWS, Google Cloud, Hetzner Cloud, DigitalOcean,
  Scaleway, OVHcloud, Clouding, Vultr, Akamai Cloud (Linode), IONOS Cloud
  and Oracle Cloud — with their load balancers, managed databases and,
  optionally, DNS records.
- **DNS and network**: Cloudflare and Tailscale.
- **Local sources**: Proxmox VE, TrueNAS and Synology, read by the InfraMole
  server through their APIs (see [Local sources](#local-sources)).
- **Other tools**: NetBox, Zabbix and PRTG — bring the inventory you already
  keep there (see [Other tools](#other-tools)).

:::note How credentials are protected
Credentials are encrypted at rest (AES-256-GCM) as soon as you save them
and are never shown again. InfraMole only calls read APIs. Give each
integration the **minimum** permissions below — nothing more.
:::

:::steps

### Create a read-only credential

**Clouds**

:::tabs
@tab Azure

1. In the Azure portal: **Microsoft Entra ID › App registrations › New
   registration** (for example `inframole-reader`).
2. **Certificates & secrets › New client secret**. Copy the value.
3. In the subscription: **Access control (IAM) › Add role assignment ›
   Reader**, assigned to the app.

You will need the **tenant id**, **subscription id**, **client id** and the
**client secret**. Reader also covers load balancers, application gateways,
Azure SQL, PostgreSQL / MySQL flexible servers and Azure DNS.
@tab AWS

1. In IAM, create a dedicated user (no console access).
2. Attach this inline policy (the `route53` line only if you turn DNS on):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ec2:DescribeInstances",
           "rds:DescribeDBInstances",
           "elasticloadbalancing:DescribeLoadBalancers",
           "elasticloadbalancing:DescribeListeners",
           "elasticloadbalancing:DescribeTargetGroups",
           "elasticloadbalancing:DescribeTargetHealth",
           "route53:ListHostedZones",
           "route53:ListResourceRecordSets"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

3. Create an access key for it.

You will need the **region**, **access key id** and **secret access key**.
One integration covers one region. Keys created with the older policy (EC2
and RDS only) keep working: load balancers are simply left out.
@tab Google Cloud

1. **IAM & Admin › Service accounts › Create service account** (for
   example `inframole-reader`).
2. Grant it **Compute Viewer** and, if you use Cloud SQL, **Cloud SQL
   Viewer** on the project.
3. **Keys › Add key › JSON**, and paste the whole file.

The key file is encrypted like any other credential.
@tab Hetzner Cloud

1. In the Hetzner Console, open the project: **Security › API tokens ›
   Generate API token**.
2. Permission: **Read** (never Read & Write).

One integration covers one project, including its DNS zones.
@tab DigitalOcean

1. **API › Tokens › Generate New Token** with **Custom scopes**.
2. Select only **droplet:read**, **load_balancer:read**,
   **database:read** and, for DNS, **domain:read** (all but the first are
   optional).

You will need the **token** (`dop_v1_…`).
@tab Scaleway

1. **IAM › Applications › Create application** (for example
   `inframole-reader`).
2. Attach a policy with only **InstancesReadOnly**,
   **LoadBalancersReadOnly** and **RelationalDatabasesReadOnly** on the
   project.
3. **API keys › Generate an API key** for the application; copy the
   **secret key**.

In the integration, list the zones to read (for example
`fr-par-1, nl-ams-1`).
@tab OVHcloud

1. Open the token page of your region: Europe
   `https://eu.api.ovh.com/createToken/`, Canada
   `https://ca.api.ovh.com/createToken/`, US
   `https://api.us.ovhcloud.com/createToken/`.
2. Give it a name (for example `inframole-reader`) and a validity, and add
   exactly these rights — one line each, method **GET** (the last two only
   for DNS):

   ```text
   GET /vps
   GET /vps/*
   GET /cloud/project
   GET /cloud/project/*
   GET /dedicated/server
   GET /dedicated/server/*
   GET /domain/zone
   GET /domain/zone/*
   ```

3. Create the keys and copy the three values.

You will need the **application key**, **application secret** and
**consumer key**. Rights cannot be changed later: to add one, create a new
key. Leave the project empty to read every Public Cloud project the key can
see.
@tab Clouding

1. In the Clouding portal: **API › Create API key**.

Clouding API keys cannot be limited to reading: create one used only by
InfraMole. InfraMole only calls `GET /v1/servers`.
@tab Vultr

1. Create a sub-account (**Account › Users**) used only by InfraMole and
   enable its API access.
2. Under **Account › API › Access Control**, allow only your InfraMole
   server's public IP.

Vultr API keys cannot be limited to reading; InfraMole only calls `GET`
(instances, load balancers, databases).
@tab Akamai (Linode)

1. **Profile › API Tokens › Create a Personal Access Token**.
2. Set **Linodes**, **NodeBalancers** and **Databases** to **Read Only** and
   everything else to **No Access**.

@tab IONOS Cloud

1. In the Data Center Designer, create a user used only by InfraMole and
   add it to a group with read access to your data centers and no create or
   edit privileges.
2. Create a token for that user (**Token Manager**, or `ionosctl token generate`).

This is IONOS **Cloud** (Compute Engine); IONOS VPS is a different product
without this API.
@tab Oracle Cloud

1. Create a user and a group (for example `inframole-readers`) with these
   policies:

   ```text
   Allow group inframole-readers to inspect compartments in tenancy
   Allow group inframole-readers to read instance-family in tenancy
   Allow group inframole-readers to read virtual-network-family in tenancy
   Allow group inframole-readers to read load-balancers in tenancy
   ```

2. **User › API keys › Add API key** and download the private key.

You will need the **tenancy OCID**, **user OCID**, key **fingerprint**,
**region** and the **private key** (PEM). Leave the compartment empty to
read every compartment of the tenancy, or replace `in tenancy` with
`in compartment <name>` and set that compartment.
:::

**DNS and network**

:::tabs
@tab Cloudflare

1. **My Profile › API Tokens › Create Token › Custom token**.
2. Permissions: **Zone · Zone · Read** and **Zone · DNS · Read**.
3. Zone resources: the zones you want (or all).

Use an API **token**, never the global API key.
@tab Tailscale

1. **Settings › OAuth clients › Generate OAuth client**.
2. Scope: **devices:core** with **read** only.

You will need the **client ID** and the **client secret** (`tskey-client-…`).
An API access token (`tskey-api-…`) also works, with the client ID left
empty, but it expires after at most 90 days.
:::

**Local sources** — see [Local sources](#local-sources) first.

:::tabs
@tab Proxmox VE

1. **Datacenter › Permissions › Users › Add**: a user only for InfraMole
   (for example `inframole@pve`).
2. **Datacenter › Permissions › Add › User Permission**: path `/`, role
   **PVEAuditor**.
3. **Datacenter › Permissions › API Tokens › Add** for that user, with
   **Privilege Separation** off (or give the token the same role).

You will need the **token ID** (`inframole@pve!sync`) and its **secret**.
IPs of VMs come from the QEMU guest agent: install it in the VM.
@tab TrueNAS

1. **Credentials › Users › Add**: a user only for InfraMole with the
   **Read-Only Administrator** role.
2. **API Keys › Add** for that user.

TrueNAS 25.04 or later (JSON-RPC API).
@tab Synology

1. **Control Panel › User & Group › Create**: an account only for
   InfraMole, without 2-step verification, with **Read only** on the shared
   folders.

Machines connected to the NAS are visible only to an administrator
account. Leave that out unless you need it.
:::

**Other tools** — they are reached like local sources.

:::tabs
@tab NetBox

**Admin › Users** (or your profile) **› API tokens › Add**: a token of a
user who can view devices, virtual machines, IP addresses and cables, with
**Write enabled** off. Both token formats work: the classic 40-character
token and the `nbt_…` tokens of NetBox 4.5+. NetBox Cloud works too.
@tab Zabbix

**Users › API tokens › Create API token** for a user whose role can read
the host groups to import (a **User** role is enough). Zabbix 6.0 or later.
The URL is the address of the Zabbix frontend, with its path if it has one
(for example `https://zabbix.example.lan/zabbix`).
@tab PRTG

**Setup › Account settings › API keys › Add API key**, access **Read**
(PRTG 22.1 or later). PRTG's API expects the key in the request address:
use https.
:::

### Add the integration

In **Settings › Integrations › Add integration**, choose the provider, give
it a name, choose how often it syncs (every 6 hours by default, from 1 hour
to 7 days) and paste the values. Some providers have options:

- **DNS records** (Azure, AWS, Hetzner Cloud, DigitalOcean, OVHcloud) and
  **Records** (Cloudflare) — see [DNS records](#dns-records).
- **Devices not in the Library** (Tailscale) — see [Tailscale](#tailscale).

:::note Preview integrations
Everything except Cloudflare, NetBox, Zabbix and the virtual machines /
databases of Azure and AWS is marked **Preview** — including their load balancers,
managed databases (Azure) and DNS records: built
from each provider's API documentation and tested against recorded
responses, but not yet against a real account. Use **Test connection**
first — it shows what would be imported without saving anything — and tell
us if something looks wrong.
:::

### Run the first sync

Click **Sync now**. The result says what was created, updated, and what is
no longer reported. After that, the integration syncs on its own schedule.
On self-hosted installations scheduled syncs need `CRON_SECRET` (set by
`gen-secrets`).

:::

## DNS records

Cloudflare imports DNS records; Azure, AWS (Route 53), Hetzner Cloud,
DigitalOcean and OVHcloud can too, with the same credential:

- **Don't import DNS records** — the default for these providers.
- **Only records pointing to servers in InfraMole** (recommended) — A /
  AAAA records whose IP belongs to a server, VM, load balancer or database in
  the Library or in the same sync, CNAMEs to them, and aliases or CNAMEs to a
  load balancer or managed database of the same sync.
- **All** A / AAAA / CNAME records.

Each name becomes a domain that _depends on_ what it points to. Names with a
label starting with `_` (DKIM, SRV…) are never imported. Route 53 is global:
turn DNS on in one AWS integration only.

## Tailscale

Tailscale does not add your machines twice. A device whose name matches a
server or VM already in the Library (by name or host name) only gets its
tailnet addresses (`100.x.y.z`, `fd7a:…`) and a `tailscale` tag **added** —
nothing else of that resource changes, and it never becomes stale because of
Tailscale. Traffic the agents see over Tailscale then belongs to the right
machine.

Devices that match nothing are created as servers only if you choose so:
**tagged devices** (the default — in Tailscale, servers usually carry tags,
people's laptops do not), **every device**, or **none**.

## Local sources

Proxmox VE, TrueNAS and Synology are called by the **InfraMole server**
itself, no agent needed. They usually live on a private network, which
InfraMole never reaches unless the administrator of a self-hosted
installation allows it:

```sh
# .env of your installation — the networks local sources may reach
INTEGRATIONS_PRIVATE_NETWORKS=192.168.1.0/24,10.0.10.0/24
```

then `docker compose up -d`. Only these integrations use it; cloud
integrations never reach private addresses. This machine (`127.0.0.1`),
link-local addresses (cloud metadata) and multicast are always refused. It
cannot be set on InfraMole Cloud: there, use the [agent](/docs/agent/hypervisors)
for Proxmox.

**Self-signed certificates.** Proxmox, TrueNAS and Synology often use one.
InfraMole never skips certificate checks: paste the certificate's **SHA-256
fingerprint** in the integration, and only that exact certificate is
accepted. To read it from a machine on the same network:

```sh
openssl s_client -connect pve.example.lan:8006 </dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
```

(Proxmox also shows it in **Node › System › Certificates**.) When the
certificate is renewed, update the fingerprint. Leave it empty for a
certificate from a trusted authority.

## Other tools

If you already keep an inventory in **NetBox**, or monitor your machines
with **Zabbix** or **PRTG**, InfraMole can start from it instead of from
zero. Like the local sources, they are called by the InfraMole server: a
NetBox, Zabbix or PRTG on a private network needs
`INTEGRATIONS_PRIVATE_NETWORKS` and, for a self-signed certificate, its
fingerprint ([Local sources](#local-sources)). A public NetBox Cloud works
anywhere, InfraMole Cloud included.

- **NetBox**: devices and virtual machines with their IP addresses,
  platform (as the OS), site, tenant, cluster, role and tags. Network gear
  (switches, routers, firewalls, access points…) becomes a network
  resource, storage a storage resource. A VM placed on a device is drawn
  on it, and a **cable** between a machine and a network device makes the
  machine _depend on_ it. Items that are planned, being decommissioned or
  in inventory are skipped.
- **Zabbix**: monitored hosts (disabled ones are skipped), the IPs and DNS
  names of their interfaces, the OS and the **point of contact** of the host
  inventory (as the [owner](/docs/manual/library#owners)), host groups and
  tags. A host with only SNMP interfaces is network gear. A **trigger
  dependency** between two hosts ("APP01 unreachable" depends on "core-sw1
  unreachable") is imported as a **suggestion** — someone declared it, you
  confirm it.
- **PRTG** (Preview): devices with their address, group and probe.

## What is imported

| Provider        | Resources                                                                                                                                | Relationships                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure           | Virtual machines (IPs, size, region, OS, tags); load balancers and application gateways, Azure SQL databases, flexible servers (Preview) | VMs and IPs in a backend pool _exposed through_ it                                                                                              |
| AWS             | EC2 instances (Name tag, IPs, platform); RDS databases; ALB / NLB load balancers (Preview)                                               | Registered targets _exposed through_ their load balancer                                                                                        |
| Google Cloud    | Compute Engine instances (internal / external IPs, machine type, zone, labels); Cloud SQL instances                                      | —                                                                                                                                               |
| Hetzner Cloud   | Servers (public IPv4 and private IPs, type, location, image, labels); load balancers                                                     | Load balancer targets (also through label selectors) _exposed through_ it                                                                       |
| DigitalOcean    | Droplets (IPs, size, region, tags); load balancers; managed databases                                                                    | Droplets of a load balancer _exposed through_ it                                                                                                |
| Scaleway        | Instances of the listed zones; load balancers; managed databases                                                                         | Backend IPs of a load balancer _exposed through_ it                                                                                             |
| OVHcloud        | VPS (display name, IPs, zone, model); Public Cloud instances; dedicated servers (as servers)                                             | —                                                                                                                                               |
| Clouding        | Servers (public / private IPs, vCores, RAM, image, power state)                                                                          | —                                                                                                                                               |
| Vultr           | Instances (IPs, plan, region, OS, tags); load balancers; managed databases                                                               | Instances of a load balancer _exposed through_ it                                                                                               |
| Akamai (Linode) | Linodes (public and private IPs, plan, region, image, tags); NodeBalancers; managed databases                                            | Backend nodes of a NodeBalancer _exposed through_ it                                                                                            |
| IONOS Cloud     | Cloud servers of every data center (NIC IPs, cores, RAM)                                                                                 | —                                                                                                                                               |
| Oracle Cloud    | Compute instances (VNIC IPs, shape, free-form tags); load balancers                                                                      | Backends of a load balancer _exposed through_ it                                                                                                |
| DNS (all above) | A / AAAA / CNAME records as domains; for Cloudflare, a `Cloudflare` external service                                                     | A record _depends on_ the resource that owns its IP; CNAME / alias → its target; proxied Cloudflare records _exposed through_ Cloudflare        |
| Tailscale       | Tailnet addresses added to matching servers / VMs; unmatched devices per your choice                                                     | —                                                                                                                                               |
| Proxmox VE      | Nodes, VMs and containers, with node, container and guest-agent IPs                                                                      | Each VM / container _hosted by_ its node                                                                                                        |
| TrueNAS         | The NAS; SMB shares, NFS exports and iSCSI targets                                                                                       | Each share _runs on_ the NAS; machines connected to a share when it is read are **suggested** as _storing data in_ it                           |
| Synology        | The NAS and its shared folders                                                                                                           | Each folder _runs on_ the NAS; with an administrator account, machines connected when it is read are **suggested** as _storing data in_ the NAS |
| NetBox          | Devices and virtual machines (IPs, platform, site / tenant / cluster / role / tags)                                                      | VM _hosted by_ its device; machine _depends on_ the network device it is cabled to                                                              |
| Zabbix          | Monitored hosts (interface IPs and DNS, OS, point of contact as owner, groups, tags)                                                     | Trigger dependencies between hosts, as **suggestions**                                                                                          |
| PRTG            | Devices (address, group, probe)                                                                                                          | —                                                                                                                                               |

Imported resources start as **Discovered**. Tags or labels named like `env`
or `environment` set the environment. Load balancer backends and placement
are read from the provider's own configuration, so they are imported as
confirmed relationships. A connection seen once on a NAS is only evidence:
review those suggestions in **Suggestions**.

## When things disappear

If a later sync no longer lists something the integration created, that
resource becomes **Stale** — it is not deleted. If it comes back, so does its
status. As a safety net, if a sync would mark more than half of an
integration's resources as stale (for example after a partial API answer),
nothing is marked and the sync message says so.

## Removing an integration

**Delete** asks whether to also retire what it created: untouched resources
are deleted, and those with notes, edits or confirmed relationships are
archived. Resources that already existed before — including machines
Tailscale only added addresses to — are never touched.
