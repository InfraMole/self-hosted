# nginx, Apache, Docker and databases on Linux

On Linux servers the agent can report what runs inside them: **nginx and
Apache sites** (on by default) and **PostgreSQL and MySQL / MariaDB
databases** (off until you turn them on), plus **HAProxy** and **Docker
containers** (on by default). They appear in the Library as
applications and databases that **run on** the server, like IIS and SQL
Server on Windows ([IIS and SQL Server](/docs/agent/windows-workloads)).

They need agent **0.3.0** or later and an InfraMole server **0.8.0** or
later. An older server does not receive them.

## What is reported

| Workload        | Reported                                                                                  | Never read                                   |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| nginx sites     | `server_name` and `listen` of each `server` block; `*_pass` targets (host:port)           | Certificates, keys, headers, anything else   |
| Apache sites    | `ServerName`, `ServerAlias`, ports, TLS; `ProxyPass` / balancer targets (host:port)       | Certificate and key paths, anything else     |
| HAProxy         | Each `frontend` / `listen`: bind ports and its backends' servers (host:port)              | Certificates, stats credentials, ACLs        |
| PostgreSQL      | Database names of each local cluster (system databases excluded)                          | Tables, data, roles, sizes                   |
| MySQL / MariaDB | Database names (system databases excluded)                                                | Tables, data, users, sizes                   |
| Docker          | Containers: name, image, state, published ports, Compose project / service / `depends_on` | Environment variables, volumes, other labels |

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

## Reverse proxies

nginx `proxy_pass` (and `fastcgi_pass`, `grpc_pass`… with their `upstream`
blocks), Apache `ProxyPass`, balancers and proxied `RewriteRule [P]`, and
HAProxy backends tell InfraMole **where each site forwards requests** — host
and port only. InfraMole then **suggests** "site depends on X":

- `127.0.0.1:3000` → whatever on the same server publishes port 3000 (a
  Docker container, for example);
- an IP → the server or VM that owns it;
- a name → the resource with that name or host name.

Targets it cannot match are skipped. Review the suggestions like any
other. Needs agent **0.6.0** and server **0.13.0**.

## Docker containers

When Docker runs on the server, the agent reads the **container list**
from the local Docker socket (on by default; `"docker": false` in
`collectors.workloads` turns it off). It never inspects containers, so
**environment variables are never read**, and labels are reduced to the
Compose project / service / `depends_on` and the host names of Traefik or
Caddy routes.

- Each container becomes a resource that runs on the server: **database**
  for database images (PostgreSQL, MySQL, MariaDB, SQL Server, MongoDB,
  Redis…), **container** for the rest, with its image version and published
  ports. Compose services keep their identity when containers are recreated.
- Compose `depends_on` → suggested _depends on_.
- A Traefik / Caddy route ``Host(`shop.example.com`)`` → the domain
  _depends on_ the container, which is _exposed through_ the proxy.
- Connections to a published port are suggested to that container.

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
