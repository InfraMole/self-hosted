# What is InfraMole

InfraMole is a lightweight **infrastructure dependency map** for small IT
teams, MSPs, startups and homelabs. It answers four questions:

- **What do I have?** Every server, VM, application, database, domain and
  service, in one Library.
- **How is it connected?** Relationships between them — typed, directed, and
  always labelled with how sure we are.
- **What depends on this?** A map generated from the data, never drawn by
  hand.
- **What could be affected if this disappears?** The impact view follows
  dependencies from any resource and shows what _could_ be affected.

## How it works

InfraMole follows three steps: **Install → Discover → Understand**.

1. **Install** a small read-only agent on your servers (Windows or Linux),
   connect a cloud account (Azure, AWS, Cloudflare and more), or import a file.
2. **Discover**: hosts, services and the network connections between them
   are observed and turned into **suggestions**.
3. **Understand**: your team confirms what matters and adds the context only
   people know. The map and the impact view do the rest.

:::note Suggestions are not facts
A connection observed on the network does not prove a dependency. InfraMole
shows detected and inferred relationships as suggestions until someone
confirms them, and impact results always say how certain each path is.
:::

## What InfraMole is not

- **Not monitoring.** No alerts, no metrics, no dashboards to stare at.
- **Not a CMDB.** No forms to fill in before you get value.
- **Never remote control.** The platform cannot run anything on your
  machines; the agent has no command channel.

## Architecture

| Component                     | What it does                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **InfraMole server**          | The web application and API, a PostgreSQL database, and Caddy for HTTPS. Runs in Docker.                                                                                                                                                             |
| **Agent** (`inframole-agent`) | One binary per server. Reports host facts, services, listening ports and aggregated TCP connections every 5 minutes over HTTPS.                                                                                                                      |
| **Integrations**              | Read-only API tokens for Azure, AWS, Cloudflare, NetBox, Zabbix and (Preview) Google Cloud, Hetzner, DigitalOcean, Scaleway, OVHcloud, Clouding, Vultr, Akamai, IONOS, Oracle Cloud, Tailscale, PRTG; Proxmox, TrueNAS and Synology on your network. |
| **Importers**                 | CSV, JSON, docker-compose and exports from Proxmox, Azure, AWS and Cloudflare.                                                                                                                                                                       |

## Self-hosted today, Cloud later

InfraMole **Community** is free and open source (AGPL-3.0): you install it on
your own server, with unlimited servers and VMs and one workspace. A hosted
**InfraMole Cloud** (we run it for you) and a **Business** edition for larger
teams are planned. See [Editions and limits](/docs/reference/editions).

## Next steps

- [Quickstart](/docs/quickstart): from zero to a first map.
- [Install on Linux](/docs/installation/linux) or
  [on Windows](/docs/installation/windows) to self-host.
- [How the agent works](/docs/agent/overview) and what it collects.
