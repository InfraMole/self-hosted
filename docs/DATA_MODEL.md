# Data Model

Source of truth for the physical schema: `apps/web/prisma/schema.prisma`.
This document explains **intent, invariants and planned entities**. Update
both in the same change.

Legend: ✅ exists in schema · 🕒 planned (milestone)

## 1. Entity overview

```
User ─< Membership >─ Workspace
                         │
      ┌──────────────────┼───────────────────────┬──────────────┬───────────────┐
      ▼                  ▼                       ▼              ▼               ▼
  Resource ─< Relationship >─ Resource    EnrollmentToken     Agent        ChangeEvent
      │             │                                          │
      │             └─< RelationshipEvidence                   └─< Observation (raw, TTL)
      └─< ResourceTag / links / notes (fields)
```

## 2. Identity & tenancy (✅ M0)

### User ✅ (Better Auth table `user`)

`id, name, email (unique), emailVerified, image, createdAt, updatedAt`,
`twoFactorEnabled`, and (M12, Cloud only) `termsVersion?`, `termsAcceptedAt?`
— set by the Better Auth `user.create.before` hook, never from client input.

### Session / Account / Verification ✅ (Better Auth)

Managed by Better Auth. `account.password` holds the password **hash**
(Better Auth uses scrypt). Never read it in app code.

### Workspace ✅

| Field                | Notes                                                  |
| -------------------- | ------------------------------------------------------ |
| id                   | cuid                                                   |
| name                 | 1–64 chars                                             |
| slug                 | unique, URL-safe, `[a-z0-9-]{3,48}`                    |
| trialEndsAt?         | Cloud: end of the Team trial (ADR-023)                 |
| overLimitSince?      | Cloud paid tiers: start of the over-limit grace period |
| createdAt, updatedAt |                                                        |

### Membership ✅

| Field                             | Notes                                   |
| --------------------------------- | --------------------------------------- |
| id                                | cuid                                    |
| workspaceId → Workspace (cascade) |                                         |
| userId → User (cascade)           |                                         |
| role                              | `OWNER` · `ADMIN` · `MEMBER` · `VIEWER` |
| createdAt                         |                                         |

Unique `(workspaceId, userId)`.

Role capabilities (enforced from M1 on):

| Capability                                                          | VIEWER | MEMBER | ADMIN | OWNER |
| ------------------------------------------------------------------- | ------ | ------ | ----- | ----- |
| Read library/map/impact/changes                                     | ✔      | ✔      | ✔     | ✔     |
| Create/edit resources & relationships, confirm/ignore suggestions   |        | ✔      | ✔     | ✔     |
| Manage agents & enrollment tokens, integrations, workspace settings |        |        | ✔     | ✔     |
| Invite members, change roles, remove members (not owners) — M8b     |        |        | ✔     | ✔     |
| Grant / change / remove the OWNER role, delete workspace            |        |        |       | ✔     |
| Leave the workspace                                                 | ✔      | ✔      | ✔     | ✔     |

A workspace always keeps at least one OWNER (demoting or removing the last
one is refused).

### Invitation ✅ M8b

`id, workspaceId (cascade), email (lower-cased), role, tokenHash (sha256,
unique), expiresAt (7 days), invitedById → User, createdAt, acceptedAt?,
acceptedById?, revokedAt?`. The token (`dmp_inv_…`, 32 random bytes) is
shown once as a link `/invite/<token>`. Re-inviting an email revokes its
previous pending invitation; max 50 pending per workspace. Accepting
requires a signed-in user **with the invited email**; it never downgrades
an existing member.

## 3. Library

### Resource ✅ M1

**Provenance (M10, ADR-021)**: `sourceRef` (nullable, indexed with
`workspaceId`) = the source that _created_ the resource —
`integration:<id>`, `collector:<agentId>:<platform>`, `file:<format>`,
`agent:<agentId>`, or `integration-removed:<name>` for rows backfilled after
their integration was deleted; null = created by a person. `sourceLabel` keeps
the source's name at creation time. Matching an existing resource never
changes these fields. For snapshot sources `lastSeenAt` = last sync that
reported it.

| Field                | Type              | Notes                                                                                                                                  |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| id                   | cuid              |                                                                                                                                        |
| workspaceId          | FK                | `@@unique([workspaceId, id])` for composite FKs                                                                                        |
| name                 | string 1–128      | display name (e.g. `APP01`)                                                                                                            |
| type                 | enum ResourceType | `SERVER, VM, APPLICATION, WINDOWS_SERVICE, LINUX_SERVICE, DATABASE, DOMAIN, API, STORAGE, NETWORK, CONTAINER, EXTERNAL_SERVICE, OTHER` |
| environment          | enum?             | `PRODUCTION, STAGING, DEVELOPMENT, TEST, OTHER` (nullable = unspecified)                                                               |
| criticality          | enum?             | `LOW, MEDIUM, HIGH, CRITICAL`                                                                                                          |
| status               | enum              | `ACTIVE` (manual), `DISCOVERED` (agent/importer, not yet reviewed), `STALE` (no longer observed), `ARCHIVED`                           |
| description          | text?             |                                                                                                                                        |
| notes                | text? ≤ 10k       | plain text (rendered as text, never HTML)                                                                                              |
| tags                 | string[]          | lowercase `[a-z0-9._:-]`, ≤ 32 chars, ≤ 20, deduplicated                                                                               |
| links                | JSONB             | `[{label, url}]` external links (https only)                                                                                           |
| metadata             | JSONB             | typed per resource type, validated by zod (e.g. `{ os, ipAddresses[], hostname, fqdn }`). **No secrets.**                              |
| source               | enum              | `MANUAL, AGENT, IMPORT` — IMPORT resources use `externalId = "<format>:<key>"` (e.g. `csv:app01`, `docker-compose:shop/web`)           |
| externalId           | string?           | idempotent upsert key per source (ADR-011)                                                                                             |
| lastSeenAt           | timestamp?        | set by agent/importer                                                                                                                  |
| createdAt, updatedAt |                   |                                                                                                                                        |

Constraints: unique `(workspaceId, source, externalId)` — a plain unique
index is enough because Postgres treats NULL `externalId`s as distinct.
Unique `(workspaceId, id)` is the target of future composite FKs. Name is not
unique (two "web" apps may exist; a duplicate warning is backlog).

**Metadata** is an allow-list validated by `resourceMetadataSchema`
(`src/server/modules/resources/schemas.ts`, `.strict()` — unknown keys are
rejected so it can never become a secrets bucket):

| Key            | Validation      |
| -------------- | --------------- |
| hostname, fqdn | ≤ 253 chars     |
| os             | ≤ 128 chars     |
| version        | ≤ 64 chars      |
| ipAddresses    | IPv4/IPv6, ≤ 32 |

**Status**: humans may set only `ACTIVE` / `ARCHIVED`; `DISCOVERED` and `STALE`
are reserved for discovery. The Library hides `ARCHIVED` unless filtered.
**Links**: `https://` only, ≤ 20. **Search** (`q`) matches name/description
(case-insensitive), exact tag, hostname substring and exact IP.

## 4. Relationships

### Relationship ✅ M2

| Field                            | Notes                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| id                               | cuid                                                                     |
| workspaceId                      |                                                                          |
| fromResourceId                   | composite FK `(workspaceId, fromResourceId) → Resource(workspaceId, id)` |
| toResourceId                     | composite FK `(workspaceId, toResourceId) → Resource(workspaceId, id)`   |
| type                             | enum RelationshipType                                                    |
| origin                           | `MANUAL · DETECTED · INFERRED`                                           |
| status                           | `CONFIRMED · UNCONFIRMED · IGNORED`                                      |
| note                             | text? — "Add context"                                                    |
| confirmedById / confirmedAt      | who/when confirmed                                                       |
| firstObservedAt / lastObservedAt | for detected/inferred                                                    |
| createdAt, updatedAt             |                                                                          |

Invariants:

- `fromResourceId != toResourceId` (check constraint).
- Unique `(workspaceId, fromResourceId, toResourceId, type)`.
- `origin = MANUAL ⇒ status = CONFIRMED` on creation.
- Deleting a resource cascades to its relationships.
- IGNORED edges are kept so discovery does not re-suggest them.

### Relationship type registry (code, not DB) ✅ `packages/graph/src/relationship-types.ts`

A unit test asserts the Prisma `RelationshipType` enum and the registry list
are identical. Presentation rules: ADR-015.

Reading: **from TYPE to**. Propagation = direction in which _failure_ flows
(see `ARCHITECTURE.md §6`).

| Type               | Example                             | Label (from → to)  | Inverse label             | Propagation |
| ------------------ | ----------------------------------- | ------------------ | ------------------------- | ----------- |
| RUNS_ON            | `IIS RUNS_ON APP01`                 | runs on            | hosts                     | reverse     |
| HOSTS              | `PVE01 HOSTS VM12`                  | hosts              | runs on                   | forward     |
| DEPENDS_ON         | `Portal DEPENDS_ON AuthAPI`         | depends on         | required by               | reverse     |
| CONNECTS_TO        | `APP01 CONNECTS_TO SQL01`           | connects to        | receives connections from | reverse     |
| USES_DATABASE      | `CustomerAPI USES_DATABASE SQL01`   | uses database      | database for              | reverse     |
| AUTHENTICATES_WITH | `Portal AUTHENTICATES_WITH AD`      | authenticates with | authenticates             | reverse     |
| EXPOSED_THROUGH    | `Portal EXPOSED_THROUGH Cloudflare` | exposed through    | exposes                   | reverse     |
| STORES_DATA_IN     | `App STORES_DATA_IN S3 bucket`      | stores data in     | stores data for           | reverse     |
| BACKS_UP_TO        | `SQL01 BACKS_UP_TO NAS01`           | backs up to        | backup target for         | none        |
| MONITORED_BY       | `APP01 MONITORED_BY Zabbix`         | monitored by       | monitors                  | none        |
| CALLS              | `Web CALLS CustomerAPI`             | calls              | called by                 | reverse     |
| LISTENS_ON         | `IIS LISTENS_ON NET-DMZ`            | listens on         | has listener              | reverse     |
| OTHER              | —                                   | related to         | related to                | none        |

Guidance: prefer `RUNS_ON` over `HOSTS` for the same pair; never store both.

Implementation notes (M2): composite FKs
`(workspaceId, fromResourceId|toResourceId) → resource(workspaceId, id)` with
`ON DELETE CASCADE`; the self-loop CHECK (`relationship_no_self_loop`) is
hand-written in migration `…_relationships`. Duplicate → `P2002` →
`RelationshipExistsError`. Note ≤ 1000 chars. Manual edges get
`confirmedById/confirmedAt`. Every create/update/delete writes a
`ChangeEvent` (`subjectType RELATIONSHIP`) with `resourceIds = [from, to]`
so it appears in both resources' Activity.
The UI shows the inverse label when viewing the `to` side.

### DiscoveryRule ✅ M15 (ADR-027)

`id, workspaceId, port?, processName? (compared case-insensitively),
resourceId? (either end; cascade), note?, createdById?, createdAt` — CHECK: at
least one of port / processName / resourceId. RLS like every tenant table.
Connection facts matching every set criterion never become suggestions, and
unreviewed suggestions whose every piece of evidence matches a rule are
deleted (change event DELETED, "Suggestion removed by an exclusion rule").
MEMBER+ create / delete (audited `discovery.rule_created` /
`discovery.rule_deleted`); at most 100 per workspace.

### RelationshipEvidence ✅ M6 (see §5)

Why a detected relationship exists: `relationshipId, kind (TCP_CONNECTION,
LISTENING_PORT_MATCH, IMPORTER), protocolGuess (e.g. MSSQL), port,
firstSeenAt, lastSeenAt, sampleCount, agentId?`.

## 5. Agents & discovery (✅ M5–M6)

### EnrollmentToken ✅

`id, workspaceId, name, tokenHash (sha256), prefix, expiresAt, maxUses?,
useCount, revokedAt?, createdById, createdAt`

### Agent ✅

`id, workspaceId, resourceId? (the host Resource it represents), hostname,
os, osVersion, arch, agentVersion, secretHash, secretPrefix, status (ACTIVE,
REVOKED), reportIntervalSec, lastSeenAt, lastIp, createdAt, revokedAt?`

### Observation ✅ (raw, short retention — default 7 days)

`id, workspaceId, agentId, receivedAt, schemaVersion, payload JSONB,
payloadBytes, processedAt?, error?`

Implementation notes (M5): `agent` is unique on `(workspaceId, machineId)`
(re-enrolling reuses the row and rotates `secretHash`); `secretHash` and
`tokenHash` are unique sha256 hex; `agent.resourceId` is a plain FK with
`ON DELETE SET NULL` (a composite FK cannot SET NULL without nulling
`workspaceId`) — the resource is always created by the server in the agent's
workspace. The host resource is keyed by `(workspaceId, source=AGENT,
externalId=agent.id)`; created as `SERVER`/`DISCOVERED`; afterwards the agent
only updates agent-owned metadata keys (`hostname`, `fqdn`, `os`,
`ipAddresses`) and `lastSeenAt` — name, type, status, notes stay human-owned.
Changes are recorded with `actorType = AGENT`.

### ConnectionFact ✅ M6

`id, workspaceId, agentId (cascade), sourceResourceId (host, cascade),
direction INBOUND|OUTBOUND, remoteIp, port (server-side), processName ("" if
unknown), remoteResourceId? (SET NULL), sampleCount, reportCount,
firstSeenAt, lastSeenAt` — unique `(agentId, direction, remoteIp, port,
processName)`. Retention 30 days since last seen.

### RelationshipEvidence ✅ M6

`id, workspaceId, relationshipId (cascade), kind TCP_CONNECTION,
connectionFactId? (SET NULL), port, protocolGuess?, processName?,
sampleCount, firstSeenAt, lastSeenAt` — unique `(relationshipId,
connectionFactId)`; mirrors the fact's counters. The demo seed creates
evidence without a fact.

### Integration ✅ M8b (ADR-018 D)

`id, workspaceId (cascade), kind AZURE|AWS|CLOUDFLARE, name (unique per
workspace), config JSONB (non-secret: tenant/subscription, region, zones),
secretCiphertext, secretIv, secretKeyVersion, secretHint? (last 4),
syncIntervalHours (1–168, default 6), lastSyncAt?, lastSyncOk?,
lastSyncMessage?, createdById, createdAt, updatedAt`. The secret is
AES-256-GCM sealed with AAD `integration:<workspaceId>:<id>`; it is never
selected for listing and never returned to a client.

### Earlier sketch (kept for reference)

- `HostService` — services/processes per host resource (name, display name,
  state, start mode) → may become `WINDOWS_SERVICE` / `LINUX_SERVICE` resources
  after confirmation.
- `ListeningSocket` — `(resourceId, protocol, port, process)`.
- `ConnectionFact` — `(workspaceId, sourceResourceId, remoteIp,
remotePort, remoteResourceId?, processName?, firstSeenAt, lastSeenAt,
sampleCount)` unique per tuple. This is what suggestions are built from.

## 2a. Row Level Security ✅ M8c (ADR-020)

Every table with `workspaceId`, plus `workspace`, has an RLS policy keyed on
the transaction settings `app.workspace_id`, `app.user_id` and
`app.bypass_rls` (helpers `app_workspace()`, `app_user()`, `app_bypass()`).
Auth tables (`user`, `session`, `account`, `verification`, `two_factor`,
`passkey`) have no RLS (Better Auth accesses them by user id).

## 2b. Account security ✅ M8c

- `user.twoFactorEnabled`; `two_factor` (Better Auth plugin: TOTP secret and
  backup codes encrypted with `BETTER_AUTH_SECRET`, lockout counters);
  `passkey` (WebAuthn public key, credential id, counter, device type).
- `workspace.requireTwoFactor` (OWNER setting): members without TOTP 2FA are
  redirected to `/account` by `requireWorkspace`. Passkeys alone do not
  satisfy it (a password sign-in would still be possible).

## 5a. Billing ✅ M9

- **Billable node** (ADR-019): a Resource of type `SERVER` or `VM` with
  status `ACTIVE` or `DISCOVERED` (`lib/billing-plans.ts`).
- **WorkspaceSubscription** (Cloud): `workspaceId (PK, cascade),
stripeCustomerId (unique), stripeSubscriptionId? (unique), status (Stripe
status), tier? (starter | team | scale, from the Stripe price), quantity
(legacy, unused), currentPeriodEnd?, cancelAtPeriodEnd, updatedAt`. RLS
  tenant policy. A tier applies while status is active / trialing / past_due
  (ADR-023); otherwise the trial or the paused state applies.
- Business licences are not stored: `DEPMAP_LICENSE_KEY` (env), verified
  offline with the Ed25519 keys in `billing/licence-keys.ts`.

## 5b. Audit ✅ M8c

### AuditEvent (append-only, security trail)

`id, workspaceId? (cascade; null = account/platform event), createdAt,
actorType USER|AGENT|SYSTEM|OPERATOR, actorId? (not a FK), actorLabel?
(email / hostname snapshot), action (catalogue in `lib/audit-actions.ts`),
targetType?, targetId?, targetLabel?, metadata JSONB? (small, never secrets),
ip?, userAgent?`. A trigger (`audit_event_guard`) refuses UPDATE, and DELETE
unless the row is older than 365 days or the transaction sets
`depmap.allow_audit_delete = on` (workspace deletion). Distinct from
ChangeEvent: ChangeEvent = infrastructure changes (product feature);
AuditEvent = security-relevant actions (accountability).

## 6. Changes ✅ M1 (write + per-resource Activity) / 🕒 M7 (feed)

### ChangeEvent (append-only)

| Field       | Notes                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id          | cuid                                                                                                                                                                                                                             |
| workspaceId |                                                                                                                                                                                                                                  |
| occurredAt  |                                                                                                                                                                                                                                  |
| actorType   | `USER · AGENT · IMPORTER · SYSTEM`                                                                                                                                                                                               |
| actorId     | userId / agentId / importer id                                                                                                                                                                                                   |
| subjectType | `RESOURCE · RELATIONSHIP · AGENT`                                                                                                                                                                                                |
| subjectId   | (not a FK — subject may be deleted)                                                                                                                                                                                              |
| kind        | `CREATED · UPDATED · DELETED` (M1), `DISCOVERED · CONFIRMED · IGNORED` (M6), `NO_LONGER_OBSERVED` (M7). IP changes, new/stopped services and opened/closed ports are `UPDATED` events with readable summaries and a bounded diff |
| summary     | human-readable one-liner, computed at write time                                                                                                                                                                                 |
| diff        | JSONB `{ field: [before, after] }` (no secrets, bounded size)                                                                                                                                                                    |

Also `subjectLabel` (subject name at the time — survives deletion) and
`resourceIds String[]` (GIN index): other resources the event concerns (both
ends of a relationship); `listChangesForResource` matches own events OR
`resourceIds has id`. Indexed
`(workspaceId, occurredAt desc)` and `(workspaceId, subjectType, subjectId)`.
Written in the same transaction as the mutation via
`recordUserChange(tx, ctx, …)` (`src/server/modules/changes/changes.ts`).
UPDATED events are only written when the diff is non-empty (comparison is
key-order-insensitive: JSONB reorders object keys); diff string values
are truncated to 200 chars. The demo seed writes `actorType = SYSTEM` events.

## 6b. Export format ✅ M8c

`depmap-workspace-export/1` (`modules/workspaces/export.ts`): `resources` and
`relationships` follow the JSON importer's shape (`id`, `name`, `type`, …,
`from`/`type`/`to`/`note`), so an export can be imported elsewhere; extra
sections (`members`, `suggestions`, `agents`, `integrations`, `changes`,
`audit`) are informational. No secrets, hashes or credentials.

## 7. Retention & minimisation ✅ M8c (enforced)

Enforced by `modules/maintenance/retention.ts` via `POST /api/cron/maintenance`
(the production `cron` service calls it every `CRON_EVERY_SECONDS`), plus
opportunistic per-agent pruning on each report.

| Data                                  | Kept                                             | Then                                                                                                                     |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Raw agent observations                | 7 days                                           | deleted                                                                                                                  |
| Connection facts                      | 30 days after last seen                          | deleted                                                                                                                  |
| Unreviewed agent suggestions (M15)    | 30 days after last observed (`lastObservedAt`)   | deleted, SYSTEM change event ("Suggestion expired…"); import-made suggestions (no `lastObservedAt`) never expire         |
| Change events (product history)       | 365 days (Cloud: the plan's 30 / 90 / 365 days)  | deleted                                                                                                                  |
| Audit events                          | 365 days                                         | deleted (the trigger allows nothing earlier)                                                                             |
| Invitations (hold an email)           | until 30 days after accepted / revoked / expired | deleted                                                                                                                  |
| Enrollment tokens (hash only)         | until 90 days after revoked / expired            | deleted                                                                                                                  |
| Revoked agents (last IP)              | 90 days after revocation                         | deleted (host resource stays)                                                                                            |
| Sessions, verification / reset tokens | until expiry                                     | deleted                                                                                                                  |
| Workspace (on deletion)               | —                                                | everything deleted immediately                                                                                           |
| Account (on deletion)                 | —                                                | user, sessions, 2FA, passkeys and solo workspaces deleted immediately; account-level audit rows kept 365 days (security) |
| Backups                               | `BACKUP_KEEP_DAYS` (default 14)                  | deleted data disappears from backups after this window                                                                   |

Never stored: passwords (only hashes), file contents, command lines with
arguments (process name + path only), environment variables, user documents,
integration secrets in clear text.
