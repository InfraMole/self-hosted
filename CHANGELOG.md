# Changelog

What changed in each InfraMole release (server, self-hosted bundle and
images). The agent has its own changelog in the InfraMole/agent repository.
To update an installation, see
[Upgrade guide](https://inframole.com/docs/operations/upgrade).

## 0.18.1 — 2026-10-02

### Changed

- Website: real screenshots of the map and of an impact, what InfraMole
  discovers, when it helps, and frequently asked questions.

### Fixed

- Map: **Expand all** / **Collapse all** re-frame the view, so the map no
  longer ends up off screen.

## 0.18.0 — 2026-10-02

### Added

- Contributions are open: issue forms, and a one-time Contributor License
  Agreement for pull requests. Release notes now come from this changelog.
- **First steps** on top of the Library: add your infrastructure, confirm
  what depends on what, open the map, and see what could be affected if your
  most depended-on resource fails. Hide it whenever you want.
- The map explains where lines come from when there are resources but no
  relationships yet; an impact with nothing affected says it is what
  InfraMole knows, not a guarantee.

### Fixed

- Proxmox, TrueNAS and Synology with a pinned self-signed certificate:
  requests after the first one were refused (TLS session resumption); every
  connection is now checked against the pinned fingerprint.
- Proxmox through the API: VMs of two clusters with the same VM id could be
  merged; resources are now keyed by cluster (Proxmox VMs already imported by
  the API integration are recreated once, and the old ones become Stale).
- An untrusted certificate now says how to fix it (pin its SHA-256
  fingerprint) instead of "unexpected error".

## 0.17.0 — 2026-10-02

### Added

- DNS records from **Azure DNS, AWS Route 53, Hetzner, DigitalOcean and
  OVHcloud**, as an option of each integration (off by default): only records
  pointing to your servers, or all of them.
- **AWS** Application / Network Load Balancers with their targets; **Azure**
  Load Balancers and Application Gateways with their backends, Azure SQL
  databases and PostgreSQL / MySQL flexible servers.
- New integrations (Preview): **Vultr, Akamai Cloud (Linode), IONOS Cloud,
  Oracle Cloud** and **Tailscale** — Tailscale adds tailnet addresses to the
  machines you already have instead of duplicating them.
- **Proxmox VE, TrueNAS and Synology** read by the server, without an agent
  (Preview). Reaching a private network needs
  `INTEGRATIONS_PRIVATE_NETWORKS`; self-signed certificates are accepted only
  by their pinned SHA-256 fingerprint. Machines connected to a NAS share are
  suggested, never confirmed.

### Changed

- The upgrade guide removes old images after each update
  (`docker image prune -af`), so they no longer fill the disk.

## 0.16.0 — 2026-10-02

### Added

- Map: simplified nodes when zoomed out, so large maps stay readable.
- Map: **saved views** (filters, focus or impact, open boxes, positions),
  shared with the workspace and openable by link.
- Map: drag a resource to pin it; **Reset positions** puts everything back.

## 0.15.2 — 2026-10-01

### Changed

- Map at scale: resources that many others point to (Active Directory,
  monitoring) show a count instead of drawing every line; lines between
  collapsed boxes are faint until selected.

### Fixed

- Large maps no longer stack servers into a tall tower.

## 0.15.1 — 2026-10-01

### Changed

- Collapsed boxes never hide relationships silently: lines say what they
  stand for, and boxes count and list what is inside.

## 0.15.0 — 2026-10-01

### Added

- Map: servers, hypervisors and clusters drawn as boxes around what runs on
  them; expand or collapse each one, or all.

## 0.14.0 — 2026-10-01

### Changed

- New map layout: entry points on top, then applications, data, compute and
  hosts; unconnected resources in a tray; large maps open at a readable size.
- Lines to something above leave from the top (no loops), also in exports.

## 0.13.3 — 2026-10-01

### Changed

- XCP-ng logo.

## 0.13.2 — 2026-10-01

### Changed

- Technology logos inside the app (single-colour), instead of letters.

## 0.13.1 — 2026-10-01

### Added

- Technology chips (PostgreSQL, nginx, Docker, Kubernetes, VMware…) on
  resources and on the map.

## 0.13.0 — 2026-10-01

### Added

- **Docker** containers (with images and Compose projects), reverse-proxy
  targets of nginx, Apache, HAProxy, Traefik and IIS, and **Kubernetes**
  nodes and workloads, from agent 0.6.0.

## 0.12.0 — 2026-09-30

### Added

- Hypervisors from the agent: **VMware vCenter / ESXi, Hyper-V and Xen
  Orchestra (XCP-ng)** — hosts and their VMs (Preview), from agent 0.5.0.

## 0.11.2 — 2026-09-30

### Fixed

- Documentation tabs beyond the fourth were empty.

## 0.11.1 — 2026-09-30

### Added

- OVHcloud VPS; Cloudflare "only records pointing to servers in InfraMole".

### Fixed

- A record pointing to an IP never resolves to another domain.

## 0.11.0 — 2026-09-30

### Added

- Integrations (Preview): **Hetzner Cloud, DigitalOcean, Scaleway,
  OVHcloud, Google Cloud and Clouding** — servers, load balancers and managed
  databases.

## 0.10.0 — 2026-09-30

### Added

- Agent self-update from signed manifests (opt-in per workspace), for agent
  0.4.0 and later.

## 0.9.0 — 2026-09-30

### Added

- Weekly email summary of what changed, on Mondays (opt-in per member;
  never an alert).

## 0.8.0 — 2026-09-30

### Added

- Linux workloads from the agent: nginx and Apache sites, PostgreSQL and
  MySQL databases.

## 0.7.0 — 2026-09-30

### Added

- Suggested exclusion rules for noisy traffic (backups, monitoring,
  antivirus…).

## 0.6.0 — 2026-09-30

### Added

- Export the map or an impact view as PNG or PDF.

## 0.5.0 — 2026-09-30

### Added

- Windows workloads from the agent: IIS sites and SQL Server databases.

## 0.4.0 — 2026-09-29

### Added

- Suggestions at scale: confirm, ignore or restore up to 1,000 at once;
  exclusion rules (port, process, resource); suggestions expire when the
  traffic stops; faster discovery and maps on large workspaces.

## 0.3.0 — 2026-09-29

### Added

- Website and documentation in Spanish.

## 0.2.3 — 2026-09-29

### Changed

- Public website wording; privacy fixes.

## 0.2.2 — 2026-09-29

### Fixed

- Demo account landing page.

## 0.2.1 — 2026-09-29

### Changed

- Demo data.

## 0.2.0 — 2026-09-29

### Added

- Invite-only sign-up (`SIGNUP=closed`), public website mode and a
  read-only public demo.

## 0.1.1 — 2026-09-29

### Changed

- Agent downloads default to the official InfraMole/agent releases.

## 0.1.0 — 2026-09-29

First public release.

- **Library** of servers, VMs, applications, databases and services, with
  provenance, bulk actions and filters.
- **Relationships** with a clear certainty model: confirmed, detected,
  inferred; **suggestions** from the agent to confirm or ignore.
- **Map** generated from the Library, with focus and filters.
- **Impact**: what could be affected if a resource fails.
- **Changes** timeline.
- Imports: CSV, JSON, docker-compose, Proxmox, Azure, AWS and Cloudflare
  exports; integrations with Azure, AWS and Cloudflare using encrypted
  read-only credentials.
- Read-only discovery **agent** for Windows and Linux, with signed releases.
- Members and roles, invitations, two-factor authentication, passkeys,
  Google and Microsoft sign-in, audit log, Row Level Security, workspace
  export and deletion, encrypted backups.
- Self-hosted bundle (Docker Compose with Caddy TLS); AGPL-3.0-only.
