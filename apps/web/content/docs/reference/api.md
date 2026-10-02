# Read-only API

Scripts and other tools can read a workspace through a small JSON API:
resources, relationships, impact and the path between two resources. It is
**read-only** — there is no endpoint that changes anything.

## Tokens

An admin creates tokens in **Settings › API tokens › New API token**:

- a token reads **one workspace**, with the rights of a viewer (owners and
  notes included);
- it is shown **once** and stored hashed; copy it into your secret store;
- it expires after 30 days, 90 days, a year, or never;
- **Revoke** stops it immediately. Creating and revoking tokens is recorded
  in the audit log.

Send it in the `Authorization` header:

```sh
curl -H "Authorization: Bearer dmp_api_..." https://inframole.example.com/api/v1/workspace
```

```powershell
$h = @{ Authorization = "Bearer $env:INFRAMOLE_API_TOKEN" }
Invoke-RestMethod -Headers $h https://inframole.example.com/api/v1/resources?type=SERVER
```

## Conventions

- Every response is JSON. Single objects come as `{ "data": … }`; lists as
  `{ "data": [ … ], "next": "<cursor>" | null }`.
- **Pagination**: `limit` (1–500, default 100). When `next` is not null,
  ask again with `cursor=<next>`.
- **Confidence**: every relationship and every affected resource carries
  `confirmed`, `detected` or `inferred`. Only `confirmed` was checked by a
  person; treat the others as suggestions. Impact means _could be
  affected_, never _will break_.
- Archived resources and ignored relationships are left out unless you ask
  for them (`status=ARCHIVED`, `status=IGNORED`).
- **Limits**: 300 requests per minute per token. Above that: `429` with a
  `Retry-After` header.
- **Errors**: `401 unauthorized` (missing, unknown, revoked or expired
  token), `404 not_found`, `400 invalid_query` (with the fields at fault),
  `429 rate_limited`.
- `v1` only ever gains fields; nothing is renamed or removed.

## Endpoints

### GET /api/v1/workspace

The token's workspace: `id`, `name`, `slug`, and how many `resources` and
`relationships` it has. A cheap way to check a token.

### GET /api/v1/resources

| Parameter     | Example         | Meaning                                                 |
| ------------- | --------------- | ------------------------------------------------------- |
| `type`        | `SERVER`        | `SERVER`, `VM`, `APPLICATION`, `DATABASE`, …            |
| `environment` | `PRODUCTION`    | `PRODUCTION`, `STAGING`, `DEVELOPMENT`, `TEST`, `OTHER` |
| `status`      | `DISCOVERED`    | Default: everything except `ARCHIVED`                   |
| `tag`         | `iis`           | Has this tag                                            |
| `owner`       | `Platform team` | Owner, exact (any case)                                 |
| `q`           | `sql`           | Name contains                                           |

Each resource:

```json
{
  "id": "cmabc…",
  "name": "SQL01",
  "type": "SERVER",
  "status": "ACTIVE",
  "environment": "PRODUCTION",
  "criticality": "CRITICAL",
  "description": "Main SQL Server",
  "notes": null,
  "owner": "DBA team",
  "ownerContact": "dba@example.com",
  "tags": ["sql-server"],
  "hostname": "sql01",
  "fqdn": "sql01.corp.local",
  "os": "Windows Server 2022",
  "version": null,
  "ipAddresses": ["10.0.0.40"],
  "ports": [],
  "links": [],
  "source": "AGENT",
  "sourceLabel": "Agent on SQL01",
  "createdAt": "2026-09-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T08:12:00.000Z"
}
```

### GET /api/v1/resources/{id}

One resource (archived ones too) with its `relationships`.

### GET /api/v1/relationships

| Parameter  | Example         | Meaning                                                      |
| ---------- | --------------- | ------------------------------------------------------------ |
| `status`   | `CONFIRMED`     | `CONFIRMED`, `UNCONFIRMED`, `IGNORED` (default: not ignored) |
| `type`     | `USES_DATABASE` | One [relationship type](/docs/reference/relationship-types)  |
| `resource` | `cmabc…`        | Relationships of this resource (either end)                  |

Each relationship:

```json
{
  "id": "cmdef…",
  "type": "USES_DATABASE",
  "label": "uses database",
  "from": { "id": "cm1…", "name": "Billing", "type": "APPLICATION" },
  "to": { "id": "cm2…", "name": "CustomersDB", "type": "DATABASE" },
  "status": "CONFIRMED",
  "origin": "MANUAL",
  "confidence": "confirmed",
  "dependency": { "dependent": "cm1…", "dependency": "cm2…" },
  "note": null,
  "createdAt": "…",
  "confirmedAt": "…"
}
```

Read it as "_from_ _label_ _to_". `dependency` says which end depends on
which — it is `null` for types that do not carry failures (backs up to,
monitored by, related to). Do not work it out from `from` / `to`: for
`hosts`, it is the `to` end that depends on the `from` end.

### GET /api/v1/resources/{id}/impact

What could be affected if the resource went down. `depth` (1–10, default 10) limits the hops.

```json
{
  "data": {
    "resource": { "id": "…", "name": "SQL01", "type": "SERVER" },
    "affected": [
      {
        "resource": { "id": "…", "name": "Billing", "type": "APPLICATION" },
        "depth": 2,
        "confidence": "confirmed",
        "path": [
          { "id": "…", "name": "SQL01" },
          { "id": "…", "name": "CustomersDB" },
          { "id": "…", "name": "Billing" }
        ],
        "relationships": ["…", "…"],
        "owner": "Finance apps",
        "ownerContact": "finance-apps@example.com"
      }
    ],
    "summary": {
      "total": 1,
      "byConfidence": { "confirmed": 1, "detected": 0, "inferred": 0 },
      "byType": { "APPLICATION": 1 }
    },
    "whoToWarn": {
      "owners": [
        { "owner": "Finance apps", "contact": "finance-apps@example.com", "resources": ["Billing"] }
      ],
      "withoutOwner": []
    }
  }
}
```

Each affected resource carries the strongest confidence any path offers,
and the shortest such path.

### GET /api/v1/path?from={id}&to={id}

How two resources are linked. `kind` is:

- `dependsOn` — _from_ depends on _to_, directly or through others;
- `usedBy` — _to_ depends on _from_;
- `connected` — they are linked, but neither depends on the other.

```json
{
  "data": {
    "kind": "dependsOn",
    "confidence": "detected",
    "path": [{ "id": "…", "name": "IT Portal", "type": "APPLICATION" }, …],
    "steps": [{ "from": "…", "to": "…", "relationship": "…", "phrase": "calls", "confidence": "detected" }, …],
    "text": "IT Portal may depend on SQL01 (detected, not confirmed):\n- IT Portal calls Billing (detected, not confirmed)\n- Billing uses database CustomersDB\n- CustomersDB runs on SQL01"
  }
}
```

`data` is `null` when they are not linked. The path uses the strongest
confidence available, then the fewest hops — the same rule as impact.
`text` is ready to paste into a change request.
