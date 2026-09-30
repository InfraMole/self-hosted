# How the agent works

`inframole-agent` is a single binary for **Windows** and **Linux** (x86-64
and ARM64). It observes the host it runs on and sends one small report to
your InfraMole server every five minutes. It is strictly **read-only**.

## What it reports

| Data | Used for |
| --- | --- |
| Hostname, FQDN, OS, kernel, architecture, boot time | Identifying the host |
| Network interfaces (name, MAC, IP addresses) | Matching connections from other hosts |
| Running services (name, state, start type) | Showing what runs on the host |
| Listening TCP ports + owning process name / path | Knowing what the host offers |
| Established TCP connections, **aggregated** per peer, port and process | Suggesting dependencies |
| Windows: IIS site names and bindings; SQL Server database names if enabled | Showing what runs on the server ([IIS and SQL Server](/docs/agent/windows-workloads)) |

Connections are sampled every 30 seconds and summarised; loopback,
link-local and multicast traffic is ignored. The full list, with a real
example report, is on [What the agent collects](/agent).

## What it never collects

Passwords, credentials, tokens, file contents, user documents, browser
data, **command-line arguments**, environment variables, logged-in users and
packet contents. The agent's data structures have no fields for them, and
the server rejects any report with unexpected fields.

## How it talks to the server

- Outbound **HTTPS only**, to your InfraMole address. Nothing connects to
  the agent; no inbound port is opened.
- **No command channel**: the server can only answer with reporting
  intervals. It can never tell the agent to run anything.
- Each agent has its own credential, created at enrollment from an
  **enrollment token** (it expires, and can be limited to a number of agents). Revoking the agent in InfraMole
  rejects its reports immediately.

## Permissions

The agent runs as a service (**LocalSystem** on Windows, **root** with
systemd on Linux) because the operating system requires it to see which
process owns each socket. It writes nothing outside its configuration
directory. Without administrator rights it still works, with fewer process
names.

## From reports to suggestions

1. The first report creates the host in the Library as **Discovered**.
2. Connections seen at least twice to an IP that belongs to exactly one
   other resource become a **detected** relationship in Suggestions
   (for example `APP01 → SQL01:1433 (likely MSSQL)`).
3. A person confirms, adds context or ignores it. Ignored pairs are never
   suggested again.
4. If a host stops reporting for three intervals it becomes **Stale**; it
   returns to its previous state when it reports again.

:::note Limits of observation
Polling can miss rare or very short connections (for example a nightly
job). NAT, load balancers and proxies hide the real peer. And a connection
does not prove a dependency — which is why a person confirms.
:::

## Verifying the binaries

Releases publish `SHA256SUMS`, signed with Sigstore, and a build-provenance
attestation for every binary. The install commands in InfraMole check the
checksum before running anything. See [Install the agent](/docs/agent/install).
