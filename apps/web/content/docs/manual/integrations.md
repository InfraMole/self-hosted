# Cloud integrations

Integrations keep InfraMole in sync with **Azure**, **AWS**,
**Cloudflare**, **Hetzner Cloud**, **DigitalOcean**, **Scaleway**,
**OVHcloud**, **Google Cloud** and **Clouding** using read-only API
credentials. They are managed by
workspace admins and owners in **Settings › Integrations**.

:::note How credentials are protected
Credentials are encrypted at rest (AES-256-GCM) as soon as you save them
and are never shown again. InfraMole only calls read APIs. Give each
integration the **minimum** permissions below — nothing more.
:::

:::steps

### Create a read-only credential

:::tabs
@tab Azure

1. In the Azure portal: **Microsoft Entra ID › App registrations › New
   registration** (for example `inframole-reader`).
2. **Certificates & secrets › New client secret**. Copy the value.
3. In the subscription: **Access control (IAM) › Add role assignment ›
   Reader**, assigned to the app.

You will need the **tenant id**, **subscription id**, **client id** and the
**client secret**.
@tab AWS

1. In IAM, create a dedicated user (no console access).
2. Attach this inline policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ec2:DescribeInstances", "rds:DescribeDBInstances"],
         "Resource": "*"
       }
     ]
   }
   ```

3. Create an access key for it.

You will need the **region**, **access key id** and **secret access key**.
One integration covers one region.
@tab Cloudflare

1. **My Profile › API Tokens › Create Token › Custom token**.
2. Permissions: **Zone · Zone · Read** and **Zone · DNS · Read**.
3. Zone resources: the zones you want (or all).

Use an API **token**, never the global API key.
@tab Hetzner Cloud

1. In the Cloud Console, open the project: **Security › API tokens ›
   Generate API token**.
2. Permission: **Read** (never Read & Write).

One integration covers one project.
@tab DigitalOcean

1. **API › Tokens › Generate New Token** with **Custom scopes**.
2. Select only **droplet:read**, **load_balancer:read** and
   **database:read** (the last two are optional).
   @tab Scaleway

3. **IAM › Applications › Create application** (for example
   `inframole-reader`).
4. Attach a policy with only **InstancesReadOnly**,
   **LoadBalancersReadOnly** and **RelationalDatabasesReadOnly** on the
   project.
5. **API keys › Generate an API key** for the application; copy the
   **secret key**.

In the integration, list the zones to read (for example
`fr-par-1, nl-ams-1`).
@tab OVHcloud

1. Create an application key at the token page of your region (for Europe,
   `https://eu.api.ovh.com/createToken/`).
2. Rights: **GET** on `/vps`, `/vps/*`, `/cloud/project`,
   `/cloud/project/*`, `/dedicated/server` and `/dedicated/server/*` —
   nothing else. (Rights cannot be changed later: to add one, create a new
   key.)

You will need the **application key**, **application secret** and
**consumer key**. Leave the project empty to read every Public Cloud project
the key can see.
@tab Google Cloud

1. **IAM & Admin › Service accounts › Create service account** (for
   example `inframole-reader`).
2. Grant it **Compute Viewer** and, if you use Cloud SQL, **Cloud SQL
   Viewer** on the project.
3. **Keys › Add key › JSON**, and paste the whole file.
   @tab Clouding

4. In the Clouding portal: **API › Create API key**.

Clouding API keys cannot be limited to reading: create one used only by
InfraMole. InfraMole only calls `GET /v1/servers`.
:::

### Add the integration

In **Settings › Integrations › Add integration**, choose the provider, give
it a name, choose how often it syncs (every 6 hours by default, from 1 hour
to 7 days) and paste the values. Optionally, for Cloudflare, list the zones
to import (empty = all) and which records: **only records pointing to
servers in InfraMole** (recommended — A / AAAA records whose IP belongs to a
server or VM in the Library, plus CNAMEs to them) or **all** A / AAAA /
CNAME records. Names with a label starting with `_` (DKIM, SRV…) are never
imported. Connect your servers first (agent or cloud integration), then
Cloudflare; a record whose server arrives later appears on the next sync.

:::note Preview integrations
Hetzner Cloud, DigitalOcean, Scaleway, OVHcloud, Google Cloud and Clouding
are marked **Preview**: they are built from each provider's API
documentation and tested against recorded responses, but not yet against a
real account. Use **Test connection** first — it shows what would be
imported without saving anything — and tell us if something looks wrong.
:::

### Run the first sync

Click **Sync now**. The result says what was created, updated, and what is
no longer reported. After that, the integration syncs on its own schedule.
On self-hosted installations scheduled syncs need `CRON_SECRET` (set by
`gen-secrets`).

:::

## What is imported

| Provider      | Resources                                                                                           | Relationships                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure         | Virtual machines with private / public IPs, size, region, OS and tags                               | —                                                                                                                                                       |
| AWS           | EC2 instances (Name tag, IPs, platform) and RDS databases                                           | —                                                                                                                                                       |
| Cloudflare    | A / AAAA / CNAME records as domains; a `Cloudflare` external service                                | Proxied records _exposed through_ Cloudflare; a record _depends on_ the resource that owns its origin IP (only if exactly one does); CNAME → its target |
| Hetzner Cloud | Servers (public IPv4 and private IPs, type, location, image, labels); load balancers                | Servers configured as load balancer targets (also through label selectors) _exposed through_ it                                                         |
| DigitalOcean  | Droplets (IPs, size, region, tags); load balancers; managed databases                               | Droplets of a load balancer _exposed through_ it                                                                                                        |
| Scaleway      | Instances of the listed zones; load balancers; managed databases                                    | Backend IPs of a load balancer _exposed through_ it (only if exactly one resource owns the IP)                                                          |
| OVHcloud      | VPS (display name, IPs, zone, model); Public Cloud instances; dedicated servers (as servers)        | —                                                                                                                                                       |
| Google Cloud  | Compute Engine instances (internal / external IPs, machine type, zone, labels); Cloud SQL instances | —                                                                                                                                                       |
| Clouding      | Servers (public / private IPs, vCores, RAM, image, power state)                                     | —                                                                                                                                                       |

Imported resources start as **Discovered**. Tags or labels named like `env`
or `environment` set the environment. A load balancer backend is read from
the provider's own configuration, so it is imported as a confirmed
relationship, not a suggestion.

## When things disappear

If a later sync no longer lists something the integration created, that
resource becomes **Stale** — it is not deleted. If it comes back, so does its
status. As a safety net, if a sync would mark more than half of an
integration's resources as stale (for example after a partial API answer),
nothing is marked and the sync message says so.

## Removing an integration

**Delete** asks whether to also retire what it created: untouched resources
are deleted, and those with notes, edits or confirmed relationships are
archived. Resources that already existed before are never touched.
