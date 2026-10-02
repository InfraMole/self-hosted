# Import files

**Library › Import** turns a file into resources and relationships. Paste
the content or upload the file; the format is detected automatically. You
always see a **preview** first — new, updated and unchanged rows, and any
errors — and nothing is saved until you click **Import**.

Imports are idempotent: importing the same file again updates what changed
and creates no duplicates.

## Supported formats

| Format                    | Produces                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- |
| **CSV**                   | A resources CSV (one resource per row) or a relationships CSV                   |
| **JSON**                  | `{ "resources": [...], "relationships": [...] }`                                |
| **docker-compose**        | One container per service (image, ports); `depends_on` / `links` as suggestions |
| **Proxmox** export        | Nodes, VMs and LXC containers, with _hosts_ relationships                       |
| **Azure** export          | Virtual machines (IPs, size, region, OS, tags)                                  |
| **AWS** export            | EC2 instances and RDS databases                                                 |
| **Cloudflare** DNS export | Domains from A / AAAA / CNAME records                                           |

## CSV

Headers are case-insensitive. Only `name` is required.

```csv
name,type,environment,criticality,ips,hostname,os,tags
APP01,server,prod,high,10.0.0.23,app01.corp.local,Windows Server 2022,iis;web
SQL01,server,prod,critical,10.0.0.40,sql01.corp.local,Windows Server 2022,sql
CustomerAPI,app,prod,high,,,,api
```

Accepted columns: `name`, `type` (server, vm, app, db, saas, domain…),
`environment` / `env` (prod, stg, dev, qa…), `criticality`, `description`,
`notes`, `tags` (separated by `;`, `,`, `|` or spaces), `ips` /
`ip_addresses`, `hostname`, `fqdn`, `os`, `version` and `id` (a stable key;
the name by default).

Relationships go in **a separate CSV** (import it after the resources) with
`from`, `type`, `to` and `note`, where `type` can be the name or a label
such as `uses database`:

```csv
from,type,to
CustomerAPI,uses database,SQL01
CustomerAPI,runs on,APP01
```

Endpoints are matched by `id` or name in the same file, then by a unique
name in the Library. Tick **Import CSV/JSON relationships as suggestions to review** to
review them in Suggestions instead of confirming them directly.

## Platform exports

Run the platform's own command where your credentials already live and
upload the JSON — InfraMole never sees your credentials:

:::tabs
@tab Proxmox

```sh
pvesh get /cluster/resources --output-format json > proxmox.json
```

@tab Azure

```sh
az vm list -d --output json > azure.json
```

@tab AWS

```sh
aws ec2 describe-instances --output json > ec2.json
aws rds describe-db-instances --output json > rds.json
```

:::

To keep them in sync automatically, use
[Integrations](/docs/manual/integrations) or the agent's
[Proxmox inventory](/docs/agent/proxmox) instead.

## Limits

1 MB per file, 2,000 resources and 5,000 relationships per import. Plan
limits apply to servers and VMs: the preview warns before an import would
go over.
