# InfraMole — self-hosted

> **See what depends on what.** A living, simple map of your infrastructure.

InfraMole maps your servers, applications, databases and domains, discovers
how they connect, and shows what could be affected before you change or
switch off anything. Read-only, lightweight, built for small IT teams, MSPs
and homelabs.

**InfraMole Community is free and open source** under the
[GNU AGPL v3.0 only](LICENSE) (`AGPL-3.0-only`): unlimited servers and VMs,
one workspace, discovery with agents (Windows and Linux: services,
connections, IIS, SQL Server, nginx, Apache, PostgreSQL, MySQL, Docker,
Kubernetes), integrations with Azure, AWS and Cloudflare (more clouds, DNS
providers, Proxmox, TrueNAS, Synology and Tailscale in preview), file
imports, a dependency map with saved views, impact analysis, owners and
who to warn, a read-only API, two-factor authentication, passkeys and an
audit log.

Try it without installing: [inframole.com/demo](https://inframole.com/demo).

## Install

Follow the step-by-step guide for Linux, Windows or macOS:
**[inframole.com/docs](https://inframole.com/docs/installation/requirements)**.

In short (Linux, Docker Compose):

```sh
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
sha256sum -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz && cd inframole-self-hosted
cp .env.example .env && ./scripts/gen-secrets.sh .env   # then set DEPMAP_DOMAIN in .env
docker compose up -d
```

Container images: `ghcr.io/inframole/web`, `ghcr.io/inframole/migrate`,
`ghcr.io/inframole/backup` — built from this repository by
`.github/workflows/release.yml`.

The agent that runs on your servers lives in
[InfraMole/agent](https://github.com/InfraMole/agent).

## Develop

Requirements: Node 22+ (see `.nvmrc`), pnpm, Docker.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm db:up && pnpm db:migrate && pnpm db:app-role && pnpm db:seed
pnpm dev                     # http://localhost:3000 — demo@depmap.local / demo-password
pnpm check                   # lint + typecheck + unit tests + build
pnpm test:integration        # needs pnpm db:up
pnpm build && pnpm test:e2e  # end-to-end tests in a browser (Playwright)
```

Layout: `apps/web` (Next.js application, Prisma schema, tests),
`packages/graph` (relationship semantics and impact), `deploy` (production
Docker Compose stack), `apps/web/content/docs` (the user documentation).

## Licence and editions

- Code: **AGPL-3.0-only** — see [LICENSE](LICENSE) and [NOTICE](NOTICE). If you
  modify InfraMole and let others use it over a network, you must offer them
  the source of your version.
- **Commercial licence**: organisations that cannot accept the AGPL can
  obtain InfraMole under commercial terms — [sales@inframole.com](mailto:sales@inframole.com).
- **InfraMole Business** adds multiple workspaces, a signed offline licence
  and priority support. **InfraMole Cloud** is the hosted service.
- The InfraMole name, logo and mascot are trademarks, not covered by the
  AGPL: [TRADEMARKS.md](TRADEMARKS.md).

Copyright (C) 2026 Alejandro Galisteo.

## Changes, contributing and security

What changed in each release: [CHANGELOG.md](CHANGELOG.md). Issues and pull
requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (pull requests
need the one-time [Contributor License Agreement](CLA.md)). Report
vulnerabilities privately: [SECURITY.md](SECURITY.md).
