# Cloud integrations

Integrations keep InfraMole in sync with **Azure**, **AWS** and
**Cloudflare** using read-only API credentials. They are managed by
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
:::

### Add the integration

In **Settings › Integrations › Add integration**, choose the provider, give
it a name, choose how often it syncs (every 6 hours by default, from 1 hour
to 7 days) and paste the values. Optionally, for Cloudflare, list the zones
to import (empty = all).

### Run the first sync

Click **Sync now**. The result says what was created, updated, and what is
no longer reported. After that, the integration syncs on its own schedule.
On self-hosted installations scheduled syncs need `CRON_SECRET` (set by
`gen-secrets`).

:::

## What is imported

| Provider   | Resources                                                             | Relationships                                                                                                                                           |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure      | Virtual machines with private / public IPs, size, region, OS and tags | —                                                                                                                                                       |
| AWS        | EC2 instances (Name tag, IPs, platform) and RDS databases             | —                                                                                                                                                       |
| Cloudflare | A / AAAA / CNAME records as domains; a `Cloudflare` external service  | Proxied records _exposed through_ Cloudflare; a record _depends on_ the resource that owns its origin IP (only if exactly one does); CNAME → its target |

Imported resources start as **Discovered**. Tags named like `env` or
`environment` set the environment.

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
