# Editions and limits

InfraMole comes in two ways to run it:

- **Self-hosted** — you run and maintain InfraMole on your own servers.
  **Community** is free and open source; **Business** adds enterprise
  capabilities, support and a commercial licence.
- **Cloud** — we run and maintain InfraMole for you, on a monthly plan.

We don't charge for understanding your infrastructure: Community has no
limit on servers or VMs. Cloud plans are sized by servers and VMs only
because we host them; everything else you discover is unlimited.

## Self-hosted

|                                                                            | Community                       | Business                                               |
| -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| Price                                                                      | Free forever                    | from 499 € / year                                      |
| Licence                                                                    | **AGPL-3.0-only** (open source) | AGPL, or a commercial licence as an alternative        |
| Servers and VMs                                                            | Unlimited                       | Unlimited                                              |
| Workspaces                                                                 | 1                               | Multiple                                               |
| Discovery (agents, Azure, AWS, Cloudflare), map, dependencies, impact      | ✔                               | ✔                                                      |
| Two-factor authentication, passkeys, Google / Microsoft sign-in, audit log | ✔                               | ✔                                                      |
| Deployment                                                                 | Docker Compose                  | Docker Compose, signed offline licence (no phone-home) |
| Support                                                                    | Community                       | Priority email support                                 |

Business: contact [sales@inframole.com](mailto:sales@inframole.com).

## Cloud

| Plan                  | Price                                    | Servers / VMs | Members   | Change history |
| --------------------- | ---------------------------------------- | ------------- | --------- | -------------- |
| **Starter**           | 19 € / month                             | 15            | 5         | 30 days        |
| **Team**              | 49 € / month                             | 60            | 15        | 90 days        |
| **Scale**             | 99 € / month                             | 250           | Unlimited | 365 days       |
| More than 250 servers | [Talk to us](mailto:sales@inframole.com) |               |           |                |

Every Cloud plan includes agents, Azure, AWS and Cloudflare discovery, and
unlimited applications, databases, containers, domains and discovered
services. Every Cloud workspace starts with **14 days of Team, free — no
card needed**.

A server or VM counts while it is **Active** or **Discovered**. Stale and
archived ones do not count.

## What happens at a Cloud limit

- **Nothing is ever deleted**, and hosts you already have keep reporting.
- **Paid plans**: you can go over the limit for **14 days**; after that,
  adding more servers or VMs requires a larger plan.
- **Trial**: adding more than the Team size is refused. If the trial ends
  without a plan, discovery pauses (agents, imports, integrations); the data
  stays readable, editable and exportable.

## Business licence

A Business licence is a signed key verified **offline** — InfraMole never
calls home. Set `EDITION=business` and `DEPMAP_LICENSE_KEY` in `.env` (see
[Configuration](/docs/installation/configuration#business-licence)). If it
expires, Community rules apply again (one workspace); nothing is removed.

## Licensing

- InfraMole Community (server) = **AGPL-3.0-only**.
- InfraMole Agent = **AGPL-3.0-only**.
- You may use, modify and self-host them freely. If you modify InfraMole and
  let others use it over a network, the AGPL requires you to offer them the
  source of your modified version.
- The **InfraMole** name, logo and mascot are trademarks and are not
  licensed under the AGPL.
- Companies that need different terms can obtain a **commercial licence**:
  [sales@inframole.com](mailto:sales@inframole.com).

Prices are early-access prices and may change before general availability.
