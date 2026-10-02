# API de solo lectura

Los scripts y otras herramientas pueden leer un espacio de trabajo con una
pequeña API JSON: recursos, relaciones, impacto y el camino entre dos
recursos. Es **de solo lectura**: no hay ningún endpoint que cambie nada.

## Tokens

Un admin crea los tokens en **Settings › API tokens › New API token**:

- un token lee **un espacio de trabajo**, con los permisos de un viewer
  (incluidos responsables y notas);
- se muestra **una sola vez** y se guarda solo su hash; cópialo en tu
  gestor de secretos;
- caduca a los 30 días, 90 días, un año o nunca;
- **Revoke** lo anula al instante. Crear y revocar tokens queda en el
  registro de auditoría.

Envíalo en la cabecera `Authorization`:

```sh
curl -H "Authorization: Bearer dmp_api_..." https://inframole.example.com/api/v1/workspace
```

```powershell
$h = @{ Authorization = "Bearer $env:INFRAMOLE_API_TOKEN" }
Invoke-RestMethod -Headers $h https://inframole.example.com/api/v1/resources?type=SERVER
```

## Convenciones

- Todas las respuestas son JSON. Un objeto llega como `{ "data": … }`; las
  listas como `{ "data": [ … ], "next": "<cursor>" | null }`.
- **Paginación**: `limit` (1–500, por defecto 100). Si `next` no es null,
  vuelve a pedir con `cursor=<next>`.
- **Certeza**: cada relación y cada recurso afectado lleva `confirmed`,
  `detected` o `inferred`. Solo `confirmed` lo ha comprobado una persona;
  trata lo demás como sugerencias. El impacto significa _podría verse
  afectado_, nunca _se romperá_.
- Los recursos archivados y las relaciones ignoradas no aparecen salvo que
  los pidas (`status=ARCHIVED`, `status=IGNORED`).
- **Límites**: 300 peticiones por minuto y token. Por encima: `429` con la
  cabecera `Retry-After`.
- **Errores**: `401 unauthorized` (token ausente, desconocido, revocado o
  caducado), `404 not_found`, `400 invalid_query` (con los campos que
  fallan), `429 rate_limited`.
- `v1` solo gana campos; nunca se renombra ni se quita ninguno.

## Endpoints

### GET /api/v1/workspace

El espacio de trabajo del token: `id`, `name`, `slug` y cuántos
`resources` y `relationships` tiene. Sirve para comprobar un token.

### GET /api/v1/resources

| Parámetro     | Ejemplo         | Significado                                             |
| ------------- | --------------- | ------------------------------------------------------- |
| `type`        | `SERVER`        | `SERVER`, `VM`, `APPLICATION`, `DATABASE`, …            |
| `environment` | `PRODUCTION`    | `PRODUCTION`, `STAGING`, `DEVELOPMENT`, `TEST`, `OTHER` |
| `status`      | `DISCOVERED`    | Por defecto: todo menos `ARCHIVED`                      |
| `tag`         | `iis`           | Tiene esa etiqueta                                      |
| `owner`       | `Platform team` | Responsable, exacto (sin distinguir mayúsculas)         |
| `q`           | `sql`           | El nombre contiene                                      |

Cada recurso:

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

Un recurso (también los archivados) con sus `relationships`.

### GET /api/v1/relationships

| Parámetro  | Ejemplo         | Significado                                                       |
| ---------- | --------------- | ----------------------------------------------------------------- |
| `status`   | `CONFIRMED`     | `CONFIRMED`, `UNCONFIRMED`, `IGNORED` (por defecto: no ignoradas) |
| `type`     | `USES_DATABASE` | Un [tipo de relación](/es/docs/reference/relationship-types)      |
| `resource` | `cmabc…`        | Relaciones de este recurso (en cualquier extremo)                 |

Cada relación:

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

Se lee «_from_ _label_ _to_». `dependency` indica qué extremo depende de
cuál; es `null` en los tipos que no propagan fallos (copia de seguridad,
monitorización, relacionado). No lo deduzcas de `from` / `to`: en `hosts`
es el extremo `to` el que depende del `from`.

### GET /api/v1/resources/{id}/impact

Qué podría verse afectado si el recurso cayera. `depth` (1–10, por defecto 10) limita los saltos.

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

Cada recurso afectado lleva la mayor certeza que ofrece algún camino, y el
camino más corto con esa certeza.

### GET /api/v1/path?from={id}&to={id}

Cómo están unidos dos recursos. `kind` vale:

- `dependsOn` — _from_ depende de _to_, directamente o a través de otros;
- `usedBy` — _to_ depende de _from_;
- `connected` — están unidos, pero ninguno depende del otro.

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

`data` es `null` si no están unidos. El camino usa la mayor certeza
disponible y después el menor número de saltos, como el impacto. `text` está
listo para pegar en una petición de cambio.
