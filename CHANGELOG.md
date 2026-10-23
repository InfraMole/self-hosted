# Changelog

What changed in each InfraMole release (server, self-hosted bundle and
images). The agent has its own changelog in the InfraMole/agent repository.
To update an installation, see
[Upgrade guide](https://inframole.com/docs/operations/upgrade).

## 0.30.0 — 2026-10-24

### Added

- **Incomplete agent reports are visible**: Settings › Agents and the host's
  page say "Last report incomplete" and what could not be read — for
  example services (access denied) or Docker containers (timed out) — or
  that the report reached its size limits. Needs agent 0.7.0 or later.
- **DNS dependencies**: when an agent reports the DNS servers its host is
  configured to use, and one of them is a resource in your inventory,
  Suggestions proposes "depends on" that server — marked as inferred and
  "configured as its DNS server — no traffic observed". It disappears when
  the host stops using that server, unless you confirmed it. Needs agent
  0.7.0 or later.
- **Redundancy in impact**: give interchangeable resources — two database
  replicas, a pair of load balancers — the same redundancy group (Edit, or
  a `redundancy_group` import column). Impact and Plan a change then list
  what depends on them as covered by redundancy while another member is up,
  show which groups lose redundancy, and count them as could be affected
  only when every member is down. Also in the map, shared views, the API
  and the workspace export.

## 0.29.1 — 2026-10-23

### Changed

- **InfraMole Cloud plans**: Starter up to 25 servers and VMs, Team up to
  100, Scale up to 250, with unlimited users on every plan. The website
  lists the prices of every edition; plans are arranged by email at
  sales@inframole.com.

## 0.29.0 — 2026-10-23

### Added

- **Light theme.** Switch with the sun and moon button at the bottom of the
  sidebar, or choose Dark, Light or Match system in Account & security ›
  Appearance. The choice is saved in each browser; dark stays the default.
  The map has its own light colours.

## 0.28.0 — 2026-10-23

### Security

- **Single sign-on secrets are now stored encrypted**, like integration
  credentials and LDAP passwords: the OpenID Connect client secret and the
  SAML signing key. Existing connections are encrypted automatically by the
  scheduled maintenance job; sign-in keeps working throughout.
- Rotating `CREDENTIALS_ENCRYPTION_KEY` now also re-encrypts every single
  sign-on secret, including LDAP settings (see
  [Configuration](https://inframole.com/docs/reference/environment)).

### Changed

- Adding or changing a single sign-on connection needs
  `CREDENTIALS_ENCRYPTION_KEY` on the server (installations made with the
  install script already have it).

## 0.27.0 — 2026-10-22

### Added

- **What's new**: every release of the server and the agent on one page,
  [inframole.com/changelog](https://inframole.com/changelog), with an RSS /
  Atom feed you can follow in a feed reader, Slack or Teams.
- **Know when to upgrade**: admins see a newer InfraMole next to the version
  in Settings (with **Check now**), at the bottom of the sidebar and in the
  weekly summary email. **Settings › Agents** marks agents older than the
  latest agent release, with how to update them.

### Changed

- New installations have the update check on (`UPDATE_CHECK=true` in
  `.env.example`): one anonymous request a day to GitHub's public releases;
  nothing about your installation is sent. Existing installations keep their
  setting — to turn it on, set `UPDATE_CHECK=true` in `.env` and run
  `docker compose up -d`. See the
  [Upgrade guide](https://inframole.com/docs/operations/upgrade#know-when-there-is-a-new-version).

## 0.26.0 — 2026-10-22

### Added

- **Other apps behind the same Caddy**: put their sites in `*.caddy` files in
  the new `caddy.d/` folder next to the `Caddyfile`. Upgrades replace the
  `Caddyfile` but never touch `caddy.d/`, so those sites survive updates. See
  [Configuration](https://inframole.com/docs/installation/configuration).

### Fixed

- Adding a SAML single sign-on connection could occasionally fail with a
  certificate error (about one time in 500); trying again worked.

## 0.25.0 — 2026-10-22

### Added

- **Plan a change**: pick the resources of a maintenance window, a migration
  or a shutdown — from the Library, an impact page or the new sidebar entry —
  and see what could be affected by all of them together, which change
  reaches what, and who to warn. Copy the report for a change request, print
  it or save it as PDF, or show it on the map. Also in the API:
  `GET /api/v1/impact?ids=…`.
- **Map export as SVG and vector PDF**, next to PNG: sharp at any zoom, with
  real text you can select and search; SVG is editable in draw.io or
  Inkscape.

- **Private demo**: `DEMO_ROLE`, `DEMO_PASSWORD` and `DEMO_RESET_HOURS` turn
  the demo into a private sandbox with your own password, where the demo
  account can change things, plus a **Reset demo** button to start again
  from the example data.

### Changed

- The map's PDF export is now vector instead of a picture.

## 0.24.1 — 2026-10-21

### Added

- Documentation: a [Security and performance](https://inframole.com/docs/security)
  page for teams evaluating InfraMole — what the agent collects and never
  collects, how it authenticates and encrypts its reports, its measured
  footprint, where the data lives and how people sign in.

## 0.24.0 — 2026-10-20

### Added

- **Single sign-on for your organization**, in every edition: workspace
  owners connect an identity provider for their email domain in Settings ›
  Single sign-on — **OpenID Connect** (Entra ID, Okta, Keycloak, Google
  Workspace…), **SAML 2.0** (ADFS, Shibboleth…) or **LDAP / Active
  Directory**. Directory groups decide each person's role (viewer, member
  or admin) at every sign-in; people who leave the groups lose access. The
  domain is proven with a DNS TXT record; "SSO only" turns password sign-in
  off for that domain. SAML requests are signed. See
  [Single sign-on](https://inframole.com/docs/manual/single-sign-on).
- New optional settings `SSO_TRUSTED_DOMAINS` (domains trusted without DNS
  proof) and `SSO_TRUSTED_ORIGINS` (identity providers and directories on
  your own network).

### Security

- Updated Next.js to 16.3.8 and Prisma to 7.10.1, and raised the minimum
  versions of sharp, mysql2 and source-map-js, fixing published advisories
  (including server-side request forgery in image optimisation and cache
  poisoning of static pages).

## 0.23.0 — 2026-10-20

### Added

- Optional web analytics with a self-hosted [Umami](https://umami.is) for
  installations that are also a public website: set `UMAMI_SCRIPT_URL`,
  `UMAMI_WEBSITE_ID` and optionally `UMAMI_DOMAINS`. Only the public pages
  are counted (website, docs, legal) — never workspaces or shared maps —
  without query strings, and Do Not Track is respected. Off by default.

### Changed

- The Content-Security-Policy is now set when the server runs, not when the
  image is built, so it can allow the analytics server only where it is
  configured.

## 0.22.0 — 2026-10-04

### Added

- **Off-site backups**: the backup service can upload every encrypted
  backup to S3-compatible storage (AWS S3, Backblaze B2, Wasabi, Scaleway,
  OVHcloud, Cloudflare R2, MinIO…) and prune old copies there. Set
  `BACKUP_S3_*` in `.env`; unencrypted backups are never uploaded.

### Changed

- Website: wording of two items in the list of what InfraMole collects.

## 0.21.0 — 2026-10-04

### Added

- **Bring your inventory**: integrations for **NetBox** and **Zabbix** —
  devices, VMs and hosts with their IPs, OS, groups and tags; a VM on its
  host, a machine depending on the switch it is cabled to (NetBox); Zabbix
  points of contact as owners and trigger dependencies as suggestions to
  review. **PRTG** devices in preview. Self-signed certificates are
  accepted by pinning their fingerprint, like Proxmox.
- **Public links to a map view**: share a saved view with someone without
  an account, read-only. IP addresses, owners, notes and anything outside
  the view are never shown; links expire when you choose and can be
  revoked in Settings.
- **Library for large inventories**: pages of 100 instead of a 500-row
  cap, sorting by any column, an Owner column.
- Creating or renaming a resource to a name that already exists asks
  first, with a link to the existing one.

## 0.20.0 — 2026-10-02

### Added

- **Path to…**: pick two resources on the map and see how they are linked —
  "A depends on B", "A may depend on B" (not confirmed yet) or "connected,
  but neither depends on the other" — with the chain to copy as text.
- **Read-only API** (`/api/v1`): resources, relationships, impact (with who
  to warn) and the path between two resources, for scripts and reports.
  Admins create tokens in **Settings › API tokens**; tokens can only read.
- **Deploying the agent to many machines**: a guide and templates for Group
  Policy, Intune, Ansible and cloud-init (in the agent repository).
- The public demo shows owners, saved views, DNS records and load balancers.

## 0.19.0 — 2026-10-02

### Added

- **Owners**: a person or team and a contact on each resource — edit one,
  set many at once from the Library, or import an `owner` column. The impact
  of any resource now shows **who to warn**, with a message to copy.
- **Quick search** with Ctrl K (⌘K): resources by name, IP, owner, tag or
  host name, and the main pages; Alt+Enter shows the resource on the map.
- **Find on map** (or `/`): select and centre a resource, even when a
  filter, a focus or a collapsed box hides it.
- **Settings show the InfraMole version**; optional `UPDATE_CHECK=true`
  tells admins when a newer release exists.

### Changed

- Website: removed the decorative example labels under the hero buttons;
  claims now match what is verified (load balancers, managed databases and
  DNS of Azure and AWS are marked Preview everywhere).
- Integration forms say which parts of Azure and AWS are still Preview.

## 0.18.2 — 2026-10-02

### Changed

- Website: an interactive example map — click any resource to see what could
  be affected — and an illustration of how the map reads, instead of
  screenshots.

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

- (Preview) DNS records from **Azure DNS, AWS Route 53, Hetzner,
  DigitalOcean and OVHcloud**, as an option of each integration (off by
  default): only records pointing to your servers, or all of them.
- (Preview) **AWS** Application / Network Load Balancers with their targets;
  **Azure** Load Balancers and Application Gateways with their backends,
  Azure SQL databases and PostgreSQL / MySQL flexible servers.
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
