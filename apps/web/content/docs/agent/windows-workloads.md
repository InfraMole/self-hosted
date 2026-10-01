# IIS and SQL Server

On Windows servers the agent can also report what runs inside them: **IIS
sites** (on by default) and **SQL Server databases** (off until you turn it
on). They appear in the Library as applications and databases that **run on**
the server, so the map and impact can name them — "Portal" and "Customers"
instead of just "WEB01" and "SQL01".

Both need agent **0.2.0** or later and an InfraMole server **0.5.0** or
later. An older server simply does not receive them.

## What is reported

| Workload   | Reported                                                                                                 | Never read                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| IIS sites  | Site name; bindings: protocol (http/https), port, host name; ARR / URL Rewrite proxy targets (host:port) | Physical paths, application pools, identities, any stored password or key |
| SQL Server | Database names per local instance (system databases excluded)                                            | Tables, data, logins, sizes, anything else                                |

The agent collects them once an hour. Run
`inframole-agent dry-run` to see exactly what would be sent.

## How they appear

| On the server  | In InfraMole                                                    |
| -------------- | --------------------------------------------------------------- |
| IIS site       | `Portal (WEB01)` — application, tag `iis`, runs on WEB01        |
| Database       | `Customers (SQL01)` — database, tag `sql-server`, runs on SQL01 |
| Named instance | `Sales (SQL01\REPORTING)`                                       |

They start as **Discovered**. A site or database that disappears becomes
**Stale** — nothing is deleted. You can rename them, add notes or change
their criticality like any other resource.

**Connections**: when a connection reaches a port that exactly one IIS site
on that server listens on (for example a site of its own on 8443), the
suggestion points to that site instead of the server. SQL Server
connections keep pointing to the server: a TCP connection does not say which
database it uses. Add a _uses database_ relationship to the right database
yourself.

## Reverse proxy rules (ARR)

When IIS forwards requests with **Application Request Routing** / URL
Rewrite (rules of type _Rewrite_ to another server, or a web farm), the
agent reports the targets — host and port only — from
`applicationHost.config` and each site's `web.config`. Only those rules
are decoded: connection strings and app settings in `web.config` are never
read. InfraMole suggests "site depends on X" for targets it can match (see
[Reverse proxies](/docs/agent/linux-workloads#reverse-proxies)). Needs
agent **0.6.0** and server **0.13.0**.

## Turn SQL Server on

:::steps

### Allow the agent to read database names

The agent connects to each local instance with its Windows service identity
(**LocalSystem**, known to SQL Server as `NT AUTHORITY\SYSTEM`) — no
password is stored. That login exists on many installations; if it does not,
create it in SQL Server Management Studio or `sqlcmd`:

```sql
CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS;
```

No extra permission is needed: every login can list database names by
default (`VIEW ANY DATABASE`).

### Enable it in the agent's configuration

Edit `C:\ProgramData\InfraMole\agent.json` as Administrator and add a
`collectors` section next to the existing keys:

```json
{
  "collectors": {
    "workloads": { "sqlServer": true }
  }
}
```

### Check and restart

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" dry-run --window 2s
Restart-Service inframole-agent
```

The `workloads` section of the dry-run output lists the databases.

:::

:::warning Failed logins
If the agent cannot log in to an instance, SQL Server records a failed
login once an hour and the agent logs a warning (see
[Manage and remove](/docs/agent/manage#logs)). That is why SQL Server is off
by default: turn it on where the login exists.
:::

## Turn IIS off

To stop reporting IIS sites on a server, add to its `agent.json`:

```json
{
  "collectors": {
    "workloads": { "iis": false }
  }
}
```

`"intervalSec"` in the same section changes how often workloads are
collected (default 3600, between 300 and 86400).
