# Security and performance

One page for the IT and security teams evaluating InfraMole: what the agent
collects, how it talks to the server, what it costs your servers, where the
data lives and how people sign in. Everything here applies to the free
Community edition.

:::cards
@card Read-only
No command channel: the server can never run anything on your machines.
@card 0 ports
The agent opens no listening port. It only connects out, over HTTPS.
@card ~15 MB
Agent memory, measured on Linux.
@card ~0.2 %
Of one CPU core, with 1,500 open connections.
@card ~19 KB
Per report, every 5 minutes, with 50 destinations.
@card On-premises
Self-hosted on your own server. Nothing phones home.
:::

## What the agent collects

The agent describes the host it runs on and the TCP connections it sees.
Nothing else.

| Collected                                                                  | Why                                         |
| -------------------------------------------------------------------------- | ------------------------------------------- |
| Hostname, OS, architecture, network interfaces and IP addresses            | Identify the host and match its connections |
| Running services and listening ports, with the owning process name         | Show what the host offers                   |
| TCP connections, **aggregated** per remote IP, port and local process name | Suggest dependencies                        |

Optional collectors read **names only**: IIS sites and bindings, SQL Server
databases (off by default), Docker containers, reverse-proxy targets (nginx,
Apache, HAProxy, Traefik), Kubernetes and hypervisor inventories. SQL
Server database clients (off by default) add, per database, the client IP
addresses, the server port and a session count — never logins or queries.

:::tip Never collected
Passwords, credentials, tokens, file contents, database content, packet
payloads, command-line arguments, environment variables and logged-in users.
The report format has no fields for them, and the server rejects any report
with unexpected fields.
:::

See exactly what a machine would send, without sending anything:

```sh
inframole-agent dry-run
```

The full list, with a real example report, is on
[What the agent collects](/agent). The agent is open source:
[github.com/InfraMole/agent](https://github.com/InfraMole/agent).

## How the agent talks to the server

:::steps

### An admin creates an enrolment token

In Settings › Agents. The token expires, can be limited to a number of
agents, and is shown only once.

### The agent exchanges it for its own credential

At installation, once. Each agent gets a random 256-bit secret; the server
stores only its SHA-256 hash.

### Reports go out over HTTPS

Every 5 minutes, started by the agent, with TLS 1.2 or later. The agent
refuses plain HTTP and redirects. Each report is at most 1 MB and is
validated against a strict schema.

### Any agent can be revoked

Revoking it in Settings › Agents rejects its next report immediately.

:::

- **No command channel.** The server can only answer with reporting
  intervals; it can never tell the agent to run anything.
- **Why it runs as a service** (LocalSystem on Windows, root on Linux): the
  operating system only shows which process owns a socket to an
  administrator. The agent writes nothing outside its configuration
  directory, and still works with fewer process names without these rights.
- **Signed releases.** Every binary is published with `SHA256SUMS`, a
  Sigstore signature and a build-provenance attestation; the install
  commands check the checksum before running anything.
- **Updates are opt-in.** Automatic updates are off by default; when turned
  on, the agent only installs releases whose manifest carries InfraMole's
  signature.

## Footprint on your servers

| Resource | Measured                                                         | How it behaves                                                                           |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Memory   | About 14–15 MB resident                                          | Stable over time                                                                         |
| CPU      | 30–60 ms per sample with 1,500 connections (0.1–0.2 % of a core) | Connections are sampled every 30 seconds; the cost grows with the number of open sockets |
| Network  | About 19 KB per report with 50 destinations (5–6 MB per day)     | Depends on how many services a server talks to, not on traffic volume; capped at 1 MB    |
| Disk     | A few KB: its configuration (and update state)                   | No local database; reports are not queued on disk                                        |

Inventory collectors (IIS, Docker, hypervisors…) run once an hour by default;
their cadence can be set between 5 minutes and one day in `agent.json`.

:::note How we measured
Agent 0.6.1 on Linux (x86-64), with 1,500 established connections to 50
services on another machine. These are lab figures, not a production
database. On a server with tens of thousands of simultaneous connections,
each sample costs proportionally more.
:::

### Busy application and database servers

- No packet capture, kernel module, driver or eBPF. The agent reads the same
  connection and process tables as `netstat` or `ss`.
- Connections are summarised before they are sent, so a busy server does not
  send bigger reports than a quiet one with the same peers.
- Optional collectors run at most once every 5 minutes, by default hourly.

## Where the data lives

- **On your server.** InfraMole runs with Docker Compose (x86-64 or ARM64)
  and PostgreSQL. Agents talk only to your server, and the software does not
  phone home. The update check (`UPDATE_CHECK`, on in new installations)
  only asks GitHub's public releases for the latest version numbers; nothing
  about your installation is sent. Set it to `false` to turn it off.
- **Workspaces are isolated twice**: in the application, and again by
  row-level security in the database.
- **Stored credentials are encrypted.** Integration tokens and single
  sign-on secrets (OpenID Connect client secrets, SAML signing keys, LDAP
  service accounts) are sealed with AES-256-GCM, with the key outside the
  database.
  Integrations only need read-only access.
- **Short retention of raw data.** Raw agent observations are deleted after
  7 days; what remains is the map: resources, relationships and their
  history.
- **Encrypted backups**, optionally copied off-site to S3-compatible storage
  ([Backup and restore](/docs/operations/backups)).
- **Your data stays yours.** Export a workspace as JSON or delete it at any
  time.

## Sign-in and access

- **Single sign-on** with your identity provider: OpenID Connect (Entra ID,
  Okta, Keycloak…), SAML 2.0 (ADFS, Shibboleth…) or LDAP / Active Directory.
  Directory groups decide each person's role at every sign-in
  ([Single sign-on](/docs/manual/single-sign-on)).
- **Two-factor authentication** (TOTP) and **passkeys** for every account; a
  workspace can require 2FA.
- **Four roles** per workspace — Viewer, Member, Admin and Owner
  ([Members and security](/docs/manual/members-and-security)).
- **Audit log** of members, integrations, agents and settings, append-only,
  kept for a year.
- **Read-only API** with tokens that can expire and be revoked
  ([Read-only API](/docs/reference/api)).
- Password sign-in is rate limited, and error messages never reveal whether
  an account exists.

## The web application

- HTTPS with automatic certificates, HSTS and a strict Content Security
  Policy; pages cannot be framed.
- The server and the agent are open source (AGPL-3.0): your team can review
  the code at [github.com/InfraMole](https://github.com/InfraMole).

:::note Report a vulnerability
Write to [security@inframole.com](mailto:security@inframole.com). Please do
not open a public issue for security problems.
:::
