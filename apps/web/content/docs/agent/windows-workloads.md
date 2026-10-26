# IIS and SQL Server

On Windows servers the agent can also report what runs inside them: **IIS
sites** (on by default) and **SQL Server databases** (off until you turn it
on). They appear in the Library as applications and databases that **run on**
the server, so the map and impact can name them — "Portal" and "Customers"
instead of just "WEB01" and "SQL01".

Both need agent **0.2.0** or later and an InfraMole server **0.5.0** or
later. An older server simply does not receive them.

## What is reported

| Workload   | Reported                                                                                                 | Never read                                             |
| ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| IIS sites  | Site name; bindings: protocol (http/https), port, host name; ARR / URL Rewrite proxy targets (host:port) | Physical paths, identities, any stored password or key |
| SQL Server | Database names per local instance (system databases excluded)                                            | Tables, data, logins, sizes, anything else             |

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
suggestion points to that site instead of the server. A TCP connection does
not say which database it uses: turn on
[database clients](#who-uses-each-database) for that.

## Which site makes a connection

IIS runs each site's code in a worker process (`w3wp.exe`) of the site's
**application pool**. When a pool serves a single site, the agent knows
which site a worker belongs to, and its connections — to SQL Server, an
API, a file server — start at that site: `Billing (WEB01) → SQL01` instead
of `WEB01 → SQL01`.

The agent asks IIS which pool each worker runs (`appcmd list wp`, read-only)
and reads the pools of each site in `applicationHost.config`. **Pool names
stay on the server**: only the site name is sent. Workers of a pool shared
by several sites keep pointing to the server. If you already have a
relationship between the two servers, it stays as it is.

On by default with IIS; needs agent **0.8.0** and server **0.33.0**.

## Who uses each database

Off by default. On a SQL Server host, the agent can list which machines have
**sessions open to which database**, from SQL Server's own session list.
InfraMole then suggests `APP01 uses database Billing (SQL01)` — the client
is matched by its IP address, like a connection.

| Reported                                                         | Never read                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Database name, client IP address, server port, how many sessions | Logins, client machine or program names, queries, data, anything else |

It is collected with every report (every 5 minutes by default). Sessions
come and go, so a client that disconnects keeps its suggestion. Clients on
the SQL Server itself are left out. Needs agent **0.8.0** and server
**0.33.0**.

:::steps

### Allow the agent to see other sessions

Without this permission SQL Server shows the agent only its own session.
Grant it to the agent's login on each instance:

```sql
GRANT VIEW SERVER STATE TO [NT AUTHORITY\SYSTEM];
```

On SQL Server 2022, `VIEW SERVER PERFORMANCE STATE` is enough. Without
either, the host's page says **"SQL Server database clients: access
denied"** instead of showing an empty list.

### Enable it in the agent's configuration

```json
{
  "collectors": {
    "workloads": { "sqlServerClients": true }
  }
}
```

This also turns database names on (`sqlServer`): clients are matched to
them. Check with `dry-run` (the `databaseClients` section) and restart the
service as below.

:::

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
