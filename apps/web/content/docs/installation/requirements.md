# Requirements

InfraMole self-hosted runs as a small set of Docker containers: the web
application, PostgreSQL, Caddy (HTTPS), a scheduler and a nightly backup job.

## Supported platforms

| Platform                                                                              | Use                                                 | Guide                                                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| **Linux** (Ubuntu 22.04+, Debian 12+, RHEL / Rocky / AlmaLinux 9+) with Docker Engine | **Recommended for production**                      | [Install on Linux](/docs/installation/linux)                    |
| **Windows 10 / 11** with Docker Desktop (WSL 2)                                       | Evaluation and small teams                          | [Install on Windows](/docs/installation/windows)                |
| **Windows Server**                                                                    | Run a Linux VM (Hyper-V) and follow the Linux guide | [Install on Windows](/docs/installation/windows#windows-server) |
| **macOS** with Docker Desktop or OrbStack                                             | Evaluation                                          | [Install on macOS](/docs/installation/macos)                    |

x86-64 and ARM64 (for example a Raspberry Pi 4/5 with 4 GB or more) are
both supported.

## Hardware

| Size               | CPU      | RAM  | Disk  |
| ------------------ | -------- | ---- | ----- |
| Up to ~100 servers | 1–2 vCPU | 2 GB | 10 GB |
| Up to ~500 servers | 2–4 vCPU | 4 GB | 20 GB |

Add room for backups (`./backups`, 14 days by default). Agent reports are
small (about 10 KB) and raw reports are kept for 7 days only.

## Network

- A **DNS name** for the server (for example `inframole.example.com`) with an
  `A` / `AAAA` record pointing at it.
- Ports **80 and 443** reachable from the internet, so Caddy can obtain a
  free Let's Encrypt certificate. Only these two ports are published.
- **Agents** need outbound HTTPS (443) to that name. Nothing connects to the
  agents.
- Optional: outbound SMTP (465 or 587) for emails, and outbound HTTPS to
  Azure / AWS / Cloudflare APIs if you use integrations.

:::note Internal-only instances
Let's Encrypt must reach ports 80/443 to issue the certificate. If the server
must stay internal, use Caddy's internal certificate authority instead (see
[Local trial](/docs/installation/configuration#local-trial-without-a-public-name)):
browsers will warn until you trust that authority on your machines.
:::

## Software

- Docker Engine **24+** with the **Compose v2** plugin (`docker compose`), or
  Docker Desktop 4.x.
- `curl` (or PowerShell on Windows) to download the release.
- Optional: an SMTP account for verification, password reset and invitation
  emails.
