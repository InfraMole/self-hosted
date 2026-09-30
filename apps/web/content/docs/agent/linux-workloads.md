# nginx, Apache and databases on Linux

On Linux servers the agent can report what runs inside them: **nginx and
Apache sites** (on by default) and **PostgreSQL and MySQL / MariaDB
databases** (off until you turn them on). They appear in the Library as
applications and databases that **run on** the server, like IIS and SQL
Server on Windows ([IIS and SQL Server](/docs/agent/windows-workloads)).

They need agent **0.3.0** or later and an InfraMole server **0.8.0** or
later. An older server does not receive them.

## What is reported

| Workload           | Reported                                                                                     | Never read                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| nginx sites        | `server_name` and `listen` of each `server` block (from `/etc/nginx/nginx.conf` and includes) | Certificates, keys, locations, upstreams, anything else           |
| Apache sites       | `ServerName`, `ServerAlias`, the ports of each `<VirtualHost>` and whether it uses TLS        | Certificate and key paths, rewrite rules, anything else           |
| PostgreSQL         | Database names of each local cluster (system databases excluded)                             | Tables, data, roles, sizes                                        |
| MySQL / MariaDB    | Database names (system databases excluded)                                                   | Tables, data, users, sizes                                        |

A site that redirects HTTP to HTTPS (two `server` blocks with the same
name) is one site with both ports. Collected once an hour; run
`sudo inframole-agent dry-run` to see exactly what would be sent.

## Turn databases on

The agent logs in over the local socket **as its own operating-system user
(root)** — no password is stored, and a server that asks for one is left
alone (the agent logs a warning).

:::steps

### Allow the agent's user to log in

:::tabs
@tab PostgreSQL

Create a role for `root`; the default `peer` authentication for local
connections then lets the agent in. The role needs no privileges: every
role can list database names.

```sh
sudo -u postgres createuser root
```

@tab MySQL / MariaDB

On Debian and Ubuntu packages, `root` already logs in with socket
authentication — nothing to do. Otherwise:

```sql
-- MariaDB
ALTER USER root@localhost IDENTIFIED VIA unix_socket;
-- MySQL
INSTALL PLUGIN auth_socket SONAME 'auth_socket.so';
CREATE USER 'root'@'localhost' IDENTIFIED WITH auth_socket;
```

If `root` needs a password on your server, keep it that way: create a
separate socket-authenticated account named after the OS user the agent
runs as.

:::

### Enable them in the agent's configuration

Edit `/etc/inframole/agent.json` with `sudo` and add a `collectors` section
next to the existing keys:

```json
{
  "collectors": {
    "workloads": { "postgresql": true, "mysql": true }
  }
}
```

### Check and restart

```sh
sudo inframole-agent dry-run --window 2s
sudo systemctl restart inframole-agent
```

:::

## How they appear

`shop.example.com (LIN01)` (application, tag `nginx`), `intranet (LIN01)`
(tag `apache`), `orders (LIN01)` (database, tag `postgresql`),
`wordpress (LIN01)` (tag `mysql`); a second PostgreSQL cluster shows its
port: `reports (LIN01\5433)`. They start as **Discovered** and become
**Stale** if they disappear. Connections to a port that only one site
listens on are suggested to that site; database connections stay on the
server.

## Turn web sites off

```json
{
  "collectors": {
    "workloads": { "webServers": false }
  }
}
```
