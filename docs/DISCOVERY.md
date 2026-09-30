# Discovery (agent ingestion ✅ M5 · facts + suggestions ✅ M6 · importers M8)

## 1. Pattern: Discover → Suggest → Confirm

1. **Discover** — sources (agent, importers) produce _facts_.
2. **Suggest** — the suggestion engine turns facts into
   `Relationship(origin=DETECTED|INFERRED, status=UNCONFIRMED)` with evidence,
   and new hosts into `Resource(status=DISCOVERED)`.
3. **Confirm** — a human confirms (→ `CONFIRMED`), adds context (changes
   type, e.g. `CONNECTS_TO` → `USES_DATABASE`, adds a note) or ignores
   (→ `IGNORED`, never re-suggested).

The map shows confirmed edges by default, with a toggle for unconfirmed
(dashed/dotted). Impact always labels confidence.

## 2. Sources

| Source                                  | Milestone | Produces                                                                                              | Relationships                                                                                                                                       |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual                                  | M1–M2 ✅  | Resources, relationships                                                                              | CONFIRMED                                                                                                                                           |
| Agent (Windows/Linux)                   | M5–M6 ✅  | Host resources, facts, suggestions                                                                    | DETECTED → review                                                                                                                                   |
| CSV / JSON import                       | M8 ✅     | Resources + relationships                                                                             | CONFIRMED (or suggestions, opt-in)                                                                                                                  |
| Docker Compose                          | M8 ✅     | CONTAINER resources (image, ports, version)                                                           | `depends_on`/`links` → DETECTED suggestions                                                                                                         |
| Proxmox / Azure / AWS exports           | M8 ✅     | Nodes, VMs, LXC; Azure VMs; EC2 + RDS (IPs, OS, tags → environment)                                   | Proxmox placement HOSTS → CONFIRMED (origin DETECTED)                                                                                               |
| Cloud APIs with stored read-only tokens | M8b ✅    | Azure / AWS / Cloudflare via Settings › Integrations (ADR-018 D)                                      | Same as the export                                                                                                                                  |
| Windows workloads (agent, M16)          | M16 ✅    | IIS sites → APPLICATION (with ports), SQL Server databases → DATABASE; per-kind snapshots, reconciled | RUNS_ON the host → CONFIRMED (origin DETECTED); connections to a port only one site binds are suggested to that site                                |
| Agent-side collectors (Proxmox API)     | M8b ✅    | Same shape inside agent reports (ADR-018 C, AGENT.md §6b); actor AGENT                                | Same                                                                                                                                                |
| Cloudflare DNS (export or integration)  | M8b ✅    | A / AAAA / CNAME → DOMAIN; `Cloudflare` EXTERNAL_SERVICE                                              | proxied → EXPOSED_THROUGH (CONFIRMED); origin by IP → DEPENDS_ON only if exactly one resource owns the IP (else warning); CNAME → DEPENDS_ON target |
| Kubernetes, Terraform                   | later     | …                                                                                                     | …                                                                                                                                                   |

Importer pipeline (ADR-017), `server/modules/importers/`:

```
text ─► parse.ts (pure: CSV / JSON / compose → ImportBatch, row errors)
     ─► plan.ts  (pure: create / update / unchanged, resolve endpoints)
     ─► importers.ts (preview | apply: all-or-nothing, events IMPORTER,
                      then refreshDetectedRelationships)
```

Accepted input (case-insensitive headers/keys):

- **Resources**: `name` (required), `type` (enum or alias: server, vm,
  app, db, saas…), `environment`/`env` (prod, stg, dev, qa…),
  `criticality`, `description`, `notes`, `tags` (`;` `,` `|` or space),
  `ip_addresses`/`ips`, `hostname`, `fqdn`, `os`, `version`, `id`
  (stable key; defaults to the name).
- **Relationships**: `from`, `type` (enum or label, e.g. "uses database"),
  `to`, `note`. Endpoints are resolved by `id`/name in the same file,
  then by unique name in the Library.
- Limits: 1 MB, 2000 resources, 5000 relationships; YAML alias expansion
  capped (billion-laughs protection).

## 3. From agent report to suggestions ✅ M6

Code: `server/modules/agents/ingestion.ts` → `server/modules/discovery/`
(`plan.ts` is the pure, unit-tested decision logic; `discovery.ts` executes it).

1. **Validate** the payload (strict zod, limits) and store a raw `Observation`.
2. **Host resource**: upsert the `SERVER` resource bound to the agent
   (`source=AGENT, externalId=agentId`, status DISCOVERED); agent-owned
   metadata changes → `ChangeEvent` (actor AGENT).
3. **Connections → facts**: one `INSERT … ON CONFLICT` upserts
   `ConnectionFact` tuples `(agent, direction, remoteIp, port, processName)`,
   adding `sampleCount`, bumping `lastSeenAt`/`reportCount`. `port` is always
   the **server-side** port (remote port for outbound, local listening port for
   inbound). Facts unseen for 30 days are deleted.
4. **Identity resolution** (whole workspace, after every report and after any
   resource save): `remoteIp` → the ONE other non-archived resource of the
   same workspace whose `metadata.ipAddresses` contains it. Ambiguous IPs
   (several owners), self, unknown → unresolved. Resolutions are re-evaluated
   each time (a removed IP un-resolves the fact).
5. **Suggest**, per resolved fact with ≥ 2 samples, oriented client → server
   (`OUTBOUND: host → remote`, `INBOUND: remote → host`), grouped per pair:
   - a relationship from→to already exists (any type): attach/refresh
     `RelationshipEvidence` on it (confirmed preferred) and bump
     `lastObservedAt`; if all of them are IGNORED, do nothing;
   - only the reverse to→from exists: do nothing (a human described it);
   - otherwise create `Relationship(from CONNECTS_TO to, DETECTED,
UNCONFIRMED)` + evidence (port, protocol guess, process, samples) and a
     `ChangeEvent` kind DISCOVERED ("Detected connection: APP01 → SQL01:1433
     (likely MSSQL)").
6. **Review** (Suggestions inbox, MEMBER+): _Confirm_ (status CONFIRMED,
   origin stays DETECTED), _Confirm as "<suggested type>"_, _Add context_
   (choose type + note, then confirm) or _Ignore_ (kept as IGNORED so it is
   never suggested again). Events CONFIRMED / IGNORED.
   **At scale ✅ M15 (ADR-027)**: the inbox lists up to 1,000, filters by
   destination / port / process, and confirms (optionally with each one's
   suggested type — skipped when it would duplicate an existing relationship
   of the pair), ignores or restores many at once (one change event each).
   _Restore_ puts IGNORED back to UNCONFIRMED ("undo ignore").
   **Exclusion rules** (`discovery_rule`: port, process, resource on either
   end; ANDed, null = any): matching facts are skipped by the planner, and
   unreviewed suggestions whose every evidence row matches are deleted;
   deleting a rule re-plans so they return. **Expiry**: the maintenance job
   deletes unreviewed suggestions not observed for 30 days (agent evidence
   only). **Incremental**: a report that changed no host IP re-plans only
   that agent's facts; a new host or an IP change re-plans the workspace.
7. **Unknown endpoints** (unresolved facts) are listed on the host's Overview
   ("Observed on this host"); adding a resource with that IP turns them into
   suggestions immediately.
8. **What changed on the host** ✅ M7 — compared with the agent's previous
   observation: IP set changes ("APP01 IP changed: 10.0.0.23 → 10.0.0.99"),
   started/stopped services and opened/closed listening ports (one bounded
   `UPDATED` event per report; the first report is the baseline).
9. **Staleness** ✅ M7 (ADR-016): after 3 missed intervals the host becomes
   `STALE` with one `NO_LONGER_OBSERVED` event; when it reports again its
   previous status is restored ("… is reporting again").

## 4. Protocol guesses (well-known ports)

Used only as a **label** on evidence ("Likely protocol: MSSQL"), never as
truth.

| Port                   | Guess                   | Suggested type upgrade |
| ---------------------- | ----------------------- | ---------------------- |
| 1433                   | MSSQL                   | USES_DATABASE          |
| 3306                   | MySQL/MariaDB           | USES_DATABASE          |
| 5432                   | PostgreSQL              | USES_DATABASE          |
| 1521                   | Oracle                  | USES_DATABASE          |
| 27017                  | MongoDB                 | USES_DATABASE          |
| 6379                   | Redis                   | DEPENDS_ON             |
| 389 / 636 / 88         | LDAP / LDAPS / Kerberos | AUTHENTICATES_WITH     |
| 445                    | SMB                     | STORES_DATA_IN         |
| 2049                   | NFS                     | STORES_DATA_IN         |
| 80 / 443 / 8080 / 8443 | HTTP(S)                 | CALLS                  |
| 5672 / 9092            | AMQP / Kafka            | DEPENDS_ON             |
| 53                     | DNS                     | DEPENDS_ON             |

## 4b. Lifecycle of imported resources ✅ M10 (ADR-021)

- Every source stamps what it creates (`sourceRef`); matching an existing
  resource by name/key never takes it over.
- **Integrations and agent collectors are snapshots**: after each successful
  sync their own resources that were not reported become **STALE**
  (`NO_LONGER_OBSERVED` event "… is no longer reported by …"); reported
  again → DISCOVERED. Nothing is deleted. Guard: if a sync would stale more
  than half of a source's resources (≥ 5), reconciliation is skipped and the
  sync message says so (partial API response). Uploaded files are not
  snapshots and never stale anything.
- **Retire** (MEMBER+, or when deleting an integration): what the source
  created is deleted if untouched, archived if a person added notes, edits,
  relationships or confirmations (any USER change event mentioning it). Only
  for removed integrations / agents and file imports; live sources would
  re-create their resources.

## 5. Noise control

Implemented:

- Agent drops loopback, link-local, unspecified and multicast peers, and
  non-ESTABLISHED sockets.
- Minimum evidence: ≥ 2 samples before a fact can become a suggestion.
- Conservative identity resolution (unique owner only); unknown IPs are
  never auto-created as resources.
- One suggestion per resource pair (all ports/processes are evidence).
- IGNORED pairs are never re-suggested; an existing relationship in either
  direction prevents new suggestions.

Backlog: per-workspace exclusions (monitoring/backup ranges, DNS/NTP
chatter), un-ignore, bulk review, suggestion expiry.

## 6. Known limitations (be honest in UI and docs)

- Polling misses very short-lived or infrequent connections (nightly jobs).
- NAT / load balancers / proxies hide the real peer.
- Containers and Kubernetes pods share host IPs or use overlay networks.
- A connection does not prove a _dependency_.
