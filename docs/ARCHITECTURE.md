# Architecture

Status: M0 implemented. Sections marked _(planned, Mx)_ describe the target
design for later milestones — keep them in sync when implementing.

## 1. Overview

A **modular monolith**: one Next.js application + one PostgreSQL database.
Later, a Go agent runs on customer servers and pushes observations over HTTPS.

```
 Browser ──HTTPS──▶ ┌─────────────────────────── apps/web (Next.js) ───────────────────────────┐
                    │  UI (React Server Components + client islands)                            │
                    │  Server Actions / Route Handlers  (/api/auth, /api/health, /api/v1 …)    │
 Agent (Go) ─HTTPS─▶│  Agent API  /api/agent/v1/*                         (planned, M5)         │
 (outbound only)    │                                                                            │
                    │  src/server/                                                               │
                    │    auth.ts ── Better Auth (sessions)                                       │
                    │    tenancy.ts ── requireWorkspace() → WorkspaceContext                     │
                    │    modules/  workspaces · resources · relationships · impact ·             │
                    │              agents · ingestion · changes · importers                     │
                    │    db.ts ── Prisma client (adapter-pg)                                     │
                    └──────────────────────────────┬─────────────────────────────────────────────┘
                                                   │
                                          PostgreSQL 17
 packages/graph (pure TS, no deps) ◀── relationship semantics, neighbourhoods; impact in M4
```

No microservices, no queues, no cache layer. Add them only with a measured
reason and an ADR.

## 2. Stack

| Concern          | Choice                                                                                                                 | ADR |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | --- |
| Web framework    | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.9 strict                                                    | 001 |
| Styling / UI     | Tailwind CSS v4, shadcn/ui-style owned components, lucide-react, Geist                                                 | 014 |
| Database         | PostgreSQL 17                                                                                                          | 002 |
| ORM              | Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`)                                                             | 002 |
| Auth             | Better Auth (email/password, DB sessions)                                                                              | 006 |
| Validation       | Zod 4 (all inputs: forms, API, agent payloads, env)                                                                    | —   |
| Graph UI         | React Flow (@xyflow/react) + ELK/dagre layout                                                                          | 003 |
| Graph algorithms | `packages/graph` (pure TS)                                                                                             | 008 |
| Agent            | Go (static binaries, Windows + Linux)                                                                                  | 004 |
| Tests            | Vitest (unit + integration against real Postgres); Playwright end-to-end on the production build (M28, `apps/web/e2e`) | 013 |
| Packaging        | pnpm workspaces; Docker (standalone Next output)                                                                       | 012 |
| CI               | GitHub Actions: lint, typecheck, test, build                                                                           | —   |

## 3. Layering rules (apps/web)

```
app/ (routes, pages, layouts, route handlers, server actions)
   │   thin: parse input (zod), call a module service, render / return
   ▼
server/modules/<module>/   business logic, plain async functions
   │   first argument is always a WorkspaceContext for tenant data
   ▼
server/db.ts (Prisma)      only modules touch Prisma for tenant tables
```

- React components never import Prisma.
- Route handlers / server actions never contain business rules; they validate
  and delegate.
- Modules do not import from `app/`.
- Cross-module calls go through the other module's exported functions, not its
  tables.
- `server/*` files start with `import "server-only"` where applicable, so they
  can never be bundled to the client.

## 4. Tenancy enforcement

1. `getSession()` (Better Auth) resolves the user from the session cookie.
2. `requireWorkspace(slug)` loads the workspace **through the user's
   membership** (`Membership where userId = session.user.id and
workspace.slug = slug`). No membership → `notFound()` (we do not reveal
   whether a workspace exists).
3. It returns `WorkspaceContext { workspaceId, workspaceSlug, userId, role }`.
4. Every module function that touches tenant data takes `ctx` and filters by
   `ctx.workspaceId`. Role checks use `assertRole(ctx, minimumRole)`.
5. Database: composite FKs `(workspaceId, id)` between tenant tables (see
   `DATA_MODEL.md`) make cross-workspace references impossible.
6. **Row Level Security (M8c, ADR-020)** — the second barrier. The app
   connects as `depmap_app`; modules query through `tenantDb(ctx)` (one
   workspace), `userDb(userId)` (own memberships / account events) or
   `systemDb("reason")` (cross-tenant jobs only). A query without a scope
   sees no tenant rows. Each scoped operation is its own transaction with
   `app.workspace_id` / `app.user_id` / `app.bypass_rls` set locally.
7. Agent requests (M5) resolve `WorkspaceContext` from the agent credential,
   never from anything in the payload.

Authorisation logic lives in `src/server/tenancy.ts` (pure helpers are unit
tested; DB-backed lookups are integration tested).

## 5. Routes (M3)

| Route                                                                     | Purpose                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                       | Signed in: first workspace or onboarding. Signed out: public landing (`components/landing/`) on `EDITION=cloud`, sign-in otherwise — M11                                                                                                                                                                                                                            |
| `/sign-in`, `/sign-up`                                                    | Auth pages                                                                                                                                                                                                                                                                                                                                                          |
| `/onboarding`                                                             | Create first workspace                                                                                                                                                                                                                                                                                                                                              |
| `/forgot-password`, `/reset-password?token=`, `/verify-email`             | Password reset and email verification (Better Auth endpoints under `/api/auth`) — M8b                                                                                                                                                                                                                                                                               |
| `/two-factor`, `/account`                                                 | 2FA verification step; account security (2FA, passkeys, recent sign-ins) — M8c                                                                                                                                                                                                                                                                                      |
| `/docs/[[...slug]]`                                                       | Public documentation portal (M12): 24 static pages from `content/docs/**/*.md` (Spanish: `/es/docs`, M14), nav in `lib/docs-nav.ts`, renderer `lib/docs-render.ts` (steps / OS tabs / callouts / heading ids), search index built at build time (`server/docs.ts`)                                                                                                  |
| `/self-hosted`                                                            | Permanent redirect to `/docs/installation/requirements` (the bundle README is still `content/self-hosted.md`)                                                                                                                                                                                                                                                       |
| `/agent`                                                                  | Public "What the agent collects" page, static, every edition (M12)                                                                                                                                                                                                                                                                                                  |
| `/demo`                                                                   | Public demo (M13, `DEMO_MODE`): ensures the example workspace, signs in with the shared read-only account                                                                                                                                                                                                                                                           |
| `/api/cron/demo`                                                          | Cron (CRON_SECRET): rebuilds the demo when older than 24 h; no-op unless `DEMO_MODE`                                                                                                                                                                                                                                                                                |
| `/sitemap.xml`, `/robots.txt`                                             | M18, request-time (`force-dynamic`): on Cloud / `PUBLIC_SITE`, the sitemap lists every public page in English and Spanish with hreflang alternates (`lib/site-pages.ts`) and robots allows the site but disallows the app (`PRIVATE_PATHS`); on any other install robots is `Disallow: /` and the sitemap is empty. Origin = `BETTER_AUTH_URL`                      |
| `/opengraph-image.png`, `/es/opengraph-image.png`                         | M18 share images (static files rendered by Chrome from `og/og-card.html`, see `og/README.md`); root metadata sets `metadataBase` = `SITE_URL`, `twitter.card = summary_large_image`, per-language `openGraph` on `/` and `/es`                                                                                                                                      |
| `/legal/[doc]`                                                            | Terms, privacy, sub-processors, legal notice — static, rendered at build time from `content/legal/*.md` (M12)                                                                                                                                                                                                                                                       |
| `/es`, `/es/agent`, `/es/demo`, `/es/legal/[doc]`, `/es/docs/[[...slug]]` | Spanish website and docs (M14, ADR-026): same components as the English routes with `locale="es"` (`components/landing/home-page.tsx`, `components/site/*`, `components/docs/{docs-shell,doc-page}.tsx`); content in `content/docs-es`, `content/legal/es`; `app/es/layout.tsx` sets `<html lang="es">`. Paths mirror the English ones (`lib/i18n.ts` `localePath`) |
| `/invite/[token]`                                                         | Invitation preview + accept (sign-in / sign-up with `?next=`, validated by `lib/safe-next.ts`) — M8b                                                                                                                                                                                                                                                                |
| `/w/[slug]/library`                                                       | Library table; filters in the URL (`q`, `type`, `environment`, `status`)                                                                                                                                                                                                                                                                                            |
| `/w/[slug]/resources/[id]`                                                | Resource Overview (layout holds header, Edit/Delete, tabs)                                                                                                                                                                                                                                                                                                          |
| `/w/[slug]/resources/[id]/activity`                                       | Resource Activity (ChangeEvents)                                                                                                                                                                                                                                                                                                                                    |
| `/w/[slug]/map`                                                           | Map (M3)                                                                                                                                                                                                                                                                                                                                                            |
| `/w/[slug]/changes`                                                       | Changes (M7)                                                                                                                                                                                                                                                                                                                                                        |
| `/w/[slug]/settings`                                                      | Workspace settings                                                                                                                                                                                                                                                                                                                                                  |
| `/api/auth/[...all]`                                                      | Better Auth handler                                                                                                                                                                                                                                                                                                                                                 |
| `/api/health`                                                             | Liveness + DB check                                                                                                                                                                                                                                                                                                                                                 |

Mutations are server actions in `src/app/w/[slug]/resources/actions.ts`
(`saveResourceAction`, `deleteResourceAction`), bound to slug/id by the page;
they call `requireWorkspace()` themselves and delegate to
`server/modules/resources`. Client forms submit them manually inside
`startTransition` (not `<form action>`) so React 19 does not reset fields on a
validation error.

Relationship mutations: `src/app/w/[slug]/resources/relationship-actions.ts`
(create bound with the viewer resource id; update/delete bound with the
relationship id).

| Route                                   | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `/w/[slug]/resources/[id]/dependencies` | Depends on / Used by / Related; add, edit, remove relationships |
| `/w/[slug]/map?focus=<resourceId>`      | Map; `focus` is validated against the workspace graph           |

| `/w/[slug]/suggestions` | Suggestions inbox: confirm / add context / ignore — M6 |
| `/w/[slug]/changes?days=&actor=&kind=&cursor=` | "What's changed?" feed — M7 |
| `/w/[slug]/library/import` | Import CSV / JSON / docker-compose with preview — M8 |
| `/w/[slug]/settings/audit?group=&cursor=` | Audit log (ADMIN+) — M8c |
| `/w/[slug]/settings/export` | GET: JSON export of the workspace (ADMIN+), audited — M8c |
| `/w/[slug]/settings/billing?checkout=` | Plan, usage, licence status; OWNER: Stripe Checkout / Customer Portal — M9 |
| `/api/stripe/webhook` | POST, Stripe-signed; checkout completed and subscription created/updated/deleted — M9 |
| `/api/agent/v1/enroll` | Agent enrollment (token → per-agent secret) — M5 |
| `/api/agent/v1/report` | Agent reports (bearer secret) — M5 |
| `/api/cron/integrations` | POST, `Authorization: Bearer $CRON_SECRET`; syncs due integrations (404 when unset) — M8b |
| `/api/cron/maintenance` | POST, same bearer guard (`server/cron.ts`); enforces the retention policy — M8c |
| `/api/cron/digest` | POST, same guard; sends the weekly digests due (Mondays from 06:00 UTC, ≤ 200 per run) — M21 |
| `/api/digest/unsubscribe?m&t` | POST unsubscribes (RFC 8058 one-click; HMAC token); GET redirects to the `/digest/unsubscribe` confirmation page (button → POST) — M21 |

Agent admin lives in `/w/[slug]/settings` (Agents + Enrollment tokens), with
server actions in `src/app/w/[slug]/settings/actions.ts` (integrations: `integration-actions.ts`, module `server/modules/integrations/` — `provider-base.ts` contract, `providers.ts` registry + Azure / AWS / Cloudflare, `cloud-providers.ts` the M23 clouds emitting the `cloud` import format; M27: `more-clouds.ts` Vultr / Linode / IONOS / Oracle, `tailscale.ts` (format `tailscale`, enrichment), `local-sources.ts` Proxmox / TrueNAS / Synology through `deps.local` (format `proxmox` / `storage`)) and the module
`server/modules/agents/` (`secrets`, `protocol`, `host`, `agents`,
`ingestion`). Helpers: `server/http.ts` (streamed body limit, IP),
`server/rate-limit.ts` (in-memory fixed window).

Modules today: `workspaces`, `resources` (`schemas.ts` pure zod + form
parsing, `diff.ts` pure, `resources.ts` DB), `relationships` (`schemas.ts`,
`relationships.ts`), `map` (`getWorkspaceGraph`), `changes` (append + read
ChangeEvents). `@depmap/graph` is consumed as TypeScript source
(`transpilePackages` in `next.config.ts`).

## 6. Graph & Impact engine _(✅ M2–M4)_

### 6.1 Edge semantics

Edges are stored as `from TYPE to`. Each type declares in the static registry
how failure propagates:

- `reverse` — if **to** fails, **from** may be affected
  (`App USES_DATABASE SQL01`: SQL01 down → App affected).
- `forward` — if **from** fails, **to** may be affected
  (`Hypervisor HOSTS VM`: hypervisor down → VM affected).
- `none` — no propagation (`MONITORED_BY`, `BACKS_UP_TO`, `OTHER`).

Full table in `DATA_MODEL.md §4`.

### 6.2 Edge confidence

- `status = CONFIRMED` → **confirmed** (regardless of origin).
- `status = UNCONFIRMED` and `origin = DETECTED` → **detected**.
- `status = UNCONFIRMED` and `origin = INFERRED` → **inferred**.
- `status = IGNORED` → excluded.

Ranking: confirmed > detected > inferred. A path's confidence is its
**weakest** edge.

### 6.3 Impact algorithm ✅ M4 (`packages/graph/src/impact.ts`)

Input: workspace edges, start resource, `maxDepth` (default 10),
`include` (which confidences to consider; default all three).

Build an "impact adjacency": for each non-ignored edge with propagation
`reverse` add `to → from`; with `forward` add `from → to`.

Then run a layered BFS:

1. BFS using only _confirmed_ edges → every node reached gets
   confidence `confirmed`, minimum hops, and one shortest path.
2. BFS using _confirmed + detected_ edges → nodes not already reached get
   `detected`.
3. BFS using all edges → remaining reached nodes get `inferred`.

This yields, for every affected node, the **strongest possible
path confidence, then the fewest hops** — exactly what the UI needs to say
"confirmed dependency, 2 hops" vs "detected relationship, 1 hop".
Cycle-safe (visited set per pass), O(3 · (V + E)).

Output: `impact(edges, rootId, { maxDepth = 10, include })` →
`ImpactResult { rootId, affected: [{ resourceId, depth, confidence,
path: resourceId[] (root first), viaEdges: edgeId[] }] }`, sorted strongest
confidence → fewest hops → id. `summarizeImpact(result, typeOf)` →
`{ total, byConfidence, byType }`.

Where it runs:

- **Resource Impact page** (`/w/[slug]/resources/[id]/impact?depth=`):
  server-side via `server/modules/impact/impact.ts#getResourceImpact(ctx, id,
maxDepth)`, over `getWorkspaceGraph` (archived resources and ignored
  relationships excluded; returns null for resources outside the graph).
- **Map impact view** (`/w/[slug]/map?impact=<id>`, or "Impact" in the
  inspector): client-side with the same function over the already-loaded
  graph. Shows only the root and affected resources; type/environment filters
  and the Unconfirmed toggle do not apply (confidence is drawn instead:
  node borders and edges solid/dashed/dotted); edges on reported paths are
  highlighted. Impact and focus are mutually exclusive.

### 6.4 Map

Saved views (M26 phase 3, ADR-041): `server/modules/map/views.ts`
(`listSavedViews`, `saveView`, `deleteSavedView`), server actions in
`app/w/[slug]/map/actions.ts`, state schema in `lib/map-view-state.ts`
(client-safe), menu `components/map/views-menu.tsx`; `?view=<id>` opens one.
Pinned positions: `groups.ts#withPins` over `nestedLayout`. Semantic zoom:
`resource-node.tsx#detailAt`.

✅ M3. `server/modules/map/map.ts#getWorkspaceGraph(ctx)` returns all
non-archived resources and non-ignored relationships of the workspace
(no cap since M15: a truncated graph silently hid dependencies from the map
and from impact). The client (`components/map/map-view.tsx`) filters (type,
environment, "Unconfirmed" toggle — off by default —, "Informational" toggle),
computes the focus subgraph with `neighbourhood()` (depth 1/2/3/all,
direction both / depends on / used by), lays it out with `stackLayout`
(`components/map/layout.ts`, M26, ADR-039) and renders it with React Flow.
`stackLayout` (no library): connected groups apart; per group, layers =
max(type layer `TYPE_LAYER`, one below everything above it) with cycles
broken by DFS and `EXPOSED_THROUGH` reversed (proxy above); rows aligned
across groups; 8 barycentre sweeps over all neighbours; x by isotonic
regression to the neighbours' mean (`placeRow`); wide layers wrap at
`MAX_ROW`; groups packed (main group + columns to its right, or shelves);
unconnected resources in a tray. 2,000 nodes in ~35 ms. Above
`DETAILED_LAYOUT_LIMIT` (300) React Flow renders only the viewport. The
first view fits everything if readable (zoom ≥ 0.55), else the main group,
else its top at 0.55 (own framing below the toolbar; only when the visible
set changes). Phase 2 (ADR-040): `groups.ts` — `containment` (single,
acyclic RUNS_ON / HOSTS placement), `displayGraph` (expanded / collapsed,
edges re-attached), `nestedLayout` (innermost boxes first, `BOX_SPACING`);
React Flow parent nodes (`type: "box"`). `layout-metrics.ts` measures aspect, crossings,
upward edges, overlaps and edge length (`layout-quality.test.ts` on the
demo).

**Export (M17, ADR-029)**: `lib/map-export/scene.ts` (pure) turns the
visible nodes (current positions), edges and view state into a scene;
`components/map/export-map.ts` paints it on a canvas (2×, reduced for huge
maps to stay under 16k px / 100 MP) and downloads PNG, or JPEG wrapped by
`lib/map-export/pdf.ts` (hand-written one-page PDF, no library). All in the
browser — no server round trip, no new dependency. Selecting a node dims everything but its neighbours and
labels its edges from the dependent's view; the inspector lists Depends on /
Used by / Related. Dragged positions are cosmetic and reset on re-layout.
`?focus=` is kept in the URL (shareable). Presentation rules: ADR-015.

## 7. Discovery pipeline _(✅ M5–M7)_

See `DISCOVERY.md §3` for the exact rules. After a report that changed no IP
address, `refreshDetectedRelationships` re-plans only that agent's facts
(M15); a new host, an IP change, a resource save, an import or a rule change
re-plans the whole workspace. Execution is batched and writes only what
changed (new suggestions with `createMany`; evidence only when its counters
moved). Load test (`pnpm test:load`, `tests/load/`): 2,000 servers / 5,247
connections — first discovery 3.1 s, full re-plan 0.1 s, one agent report
~0.1 s, map data 15 ms, impact 15 ms.

```
Agent ─POST /api/agent/v1/report─▶ validate (zod, size limits) ─▶ Observation (raw, short TTL)
                                          │
                                          ▼
                              normalise → HostFacts (services, listening sockets)
                                        → ConnectionFacts (aggregated tuples)
                                          │
                                          ▼
                              resolve identities (IP → Resource)
                                          │
                                          ▼
                              suggestion engine → Relationship(DETECTED, UNCONFIRMED) + evidence
                                          │
                                          ▼
                              ChangeEvents (discovered / changed / no longer observed)
```

Processing is synchronous inside the report request at first (payloads are
small); move to a background job table only if latency requires it. Details
in `DISCOVERY.md` and `AGENT.md`.

## 8. Configuration

All env vars are validated by `src/server/env.ts` (Zod). See
`apps/web/.env.example`. Never read `process.env` elsewhere (exceptions:
`next.config.ts`, `prisma.config.ts`, test setup).

Validation, the Prisma client (`getDb()`) and Better Auth (`getAuth()`) are
**lazy singletons**: nothing touches env/DB at import time, so `next build`
and `prisma generate` run without secrets or a database. The first request
fails fast if configuration is invalid. Pages must call `headers()` /
`requireWorkspace()` before any DB access so they are rendered dynamically.

| Variable                                                                                  | Purpose                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                            | App connection as `depmap_app` (Row Level Security applies; ADR-020)                                                                                                                                   |
| `DATABASE_URL_ADMIN`                                                                      | Owner connection for migrations, the seed and `pnpm db:app-role` (the app itself uses `DATABASE_URL` = `depmap_app`, ADR-020)                                                                          |
| `DATABASE_URL_TEST`                                                                       | Integration tests only; must end in `_test`                                                                                                                                                            |
| `BETTER_AUTH_SECRET`                                                                      | ≥ 32 chars, signs sessions                                                                                                                                                                             |
| `BETTER_AUTH_URL`                                                                         | Public base URL; `https://` in production                                                                                                                                                              |
| `CREDENTIALS_ENCRYPTION_KEY` (+ `_PREVIOUS`, `CREDENTIALS_KEY_VERSION`)                   | Optional. AES-256-GCM key for stored integration tokens (ADR-018)                                                                                                                                      |
| `CRON_SECRET`                                                                             | Optional. Bearer secret for `/api/cron/*`                                                                                                                                                              |
| `INTEGRATIONS_PRIVATE_NETWORKS`                                                           | Optional, self-hosted only (refused with `EDITION=cloud`). CIDRs the local-source integrations (Proxmox, TrueNAS, Synology) may reach — M27, ADR-042                                                   |
| `UPDATE_CHECK`                                                                            | Optional, default false. Admins see a newer release in Settings (one anonymous GET per day) — M29                                                                                                      |
| `INFRAMOLE_BUILD_VERSION`                                                                 | Set in release images at build time (Dockerfile ARG); shown in Settings                                                                                                                                |
| `TRUST_PROXY`                                                                             | `true` only behind our reverse proxy: client IP from `X-Real-IP` (overwritten by Caddy). Otherwise the rightmost `X-Forwarded-For` entry (`server/http.ts` `clientIp`, Better Auth `ipAddressHeaders`) |
| `FEEDBACK_EMAIL`                                                                          | Optional (M12). In-app feedback recipient; needs SMTP. Unset ⇒ no Feedback button                                                                                                                      |
| `SIGNUP`                                                                                  | `open` (default) or `closed` = invite-only: first account + invited addresses only (M13, ADR-025)                                                                                                      |
| `PUBLIC_SITE`                                                                             | `true` shows the public website at `/` on any edition (InfraMole's own site, M13)                                                                                                                      |
| `DEMO_MODE`                                                                               | `true` enables the public read-only demo at `/demo` (M13). Never on a database with a real `demo` workspace                                                                                            |
| `SMTP_URL`, `MAIL_FROM`                                                                   | Optional. Outgoing email (nodemailer). Set ⇒ email verification required; unset ⇒ printed to the log in dev, dropped in production                                                                     |
| `AGENT_DOWNLOAD_BASE_URL`                                                                 | Optional. Release base URL (e.g. `…/releases/latest/download`); enables download links + checksum-verifying install commands in the enrollment sheet                                                   |
| `EDITION`, `DEPMAP_LICENSE_KEY`                                                           | Edition (community default · cloud · business) and the Business licence (ADR-019, `modules/billing`)                                                                                                   |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER` / `_TEAM` / `_SCALE` | Cloud billing (EDITION=cloud, ADR-023); all five enable Stripe (one flat monthly Price per tier). Use a restricted key where possible                                                                  |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `MICROSOFT_TENANT_ID`            | Optional SSO sign-in (M8c); a provider is enabled only when id and secret are set. Redirect URI `<BETTER_AUTH_URL>/api/auth/callback/<provider>`                                                       |

Local ports: Postgres on host **5452** (`DEPMAP_DB_PORT`), app on 3000
(`next dev`) or `DEPMAP_WEB_PORT` in compose. If the app runs on another port,
`BETTER_AUTH_URL` must match it or Better Auth rejects requests (origin
check).

## 9. Deployment

- `docker-compose.yml` at the root:
  - `db` — Postgres 17 (always; `pnpm db:up`). An init script also creates
    `depmap_test`.
  - profile `app`: `migrate` (Dockerfile target `migrate`, runs
    `prisma migrate deploy` and exits) → `web` (target `runner`: Next.js
    `output: "standalone"`, non-root, `node apps/web/server.js`).
- `apps/web/Dockerfile` is multi-stage with the **repo root as build
  context**: `deps` → `migrate` | `build` → `runner`.
- **Production: `deploy/` + [`DEPLOYMENT.md`](DEPLOYMENT.md)** — Caddy
  terminates TLS (Let's Encrypt) and is the only published service; `web`,
  `db`, `migrate`, `cron` (scheduled integration sync) and `backup`
  (nightly `pg_dump`) live on an internal network. `TRUST_PROXY=true` there.
  Production must set `BETTER_AUTH_URL` to an `https://` URL and a real
  `BETTER_AUTH_SECRET`.
- Migrations always run as a separate step before the new version starts
  (`pnpm db:deploy` or the `migrate` container) — never on web startup.

## 10. Repository structure

```
.
├── README.md
├── docs/                     # Source of truth for product/architecture/state
├── apps/
│   └── web/                  # Next.js modular monolith
│       ├── prisma/           # schema.prisma + migrations
│       ├── prisma.config.ts
│       ├── src/
│       │   ├── app/          # routes (App Router)
│       │   ├── components/   # ui/ primitives, app-shell/, feature components
│       │   ├── lib/          # client-safe utilities
│       │   ├── server/       # server-only: env, db, auth, tenancy, modules/
│       │   └── generated/    # Prisma client (gitignored, generated)
│       └── tests/            # integration tests (need Postgres)
├── packages/graph/           # @depmap/graph: pure TS graph semantics + algorithms
├── agent/                    # Go agent (see agent/README.md)
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## End-to-end tests (M28)

`apps/web/e2e` + `playwright.config.ts`: `pnpm build && pnpm test:e2e`, also
in CI after the build. `global-setup.ts` recreates `depmap_e2e` (same
Postgres as `DATABASE_URL_TEST`), migrates it and enables the app role; the
server under test is `next start` on port 3100 with an isolated env
(`e2e/env.ts` — never the developer's `.env` settings). Projects run in
order on one installation: **setup** (sign up the first account, create the
workspace, import a small infrastructure through the UI, save the session),
**core** (Library, map — boxes, saved views, pins —, impact) and **sources**
(enrollment token in the UI → enroll + report through the real agent API with
the Go golden report; a Proxmox integration against a fake Proxmox API over
TLS on the machine's private IP, reached only through
`INTEGRATIONS_PRIVATE_NETWORKS` and a pinned self-signed certificate). No
test hooks in the application.

## First steps (M28)

`server/modules/workspaces/first-steps.ts#getFirstStepsFacts` (resources,
pending suggestions, confirmed relationships, and the "showcase" resource:
the most-depended-on of up to 25 candidates by `impact()` size) feeds
`components/onboarding/first-steps.tsx` on the Library. What a viewer has
looked at (map, impact) is per-browser (`lib/first-steps.ts`, localStorage,
`useSyncExternalStore`), marked by the map view and the impact page.

## Daily use (M29)

Owners: `Resource.owner` / `ownerContact`, `resources.ts#setOwner` (bulk),
`lib/notify.ts` (who to warn, pure), impact page section. Quick search:
`app/w/[slug]/search-actions.ts` + `components/app-shell/quick-search.tsx`
(Ctrl+K). Find on map: `components/map/map-find.tsx`. Version:
`server/version.ts` (`currentVersion`, opt-in `latestVersion`).
