# Relationship types

A relationship reads **from → type → to**. The last column says whether a
failure of one side could affect the other — that is what the
[impact view](/docs/manual/map-and-impact#impact) follows.

| Type               | Example                               | Seen from the other side  | A failure could travel              |
| ------------------ | ------------------------------------- | ------------------------- | ----------------------------------- |
| runs on            | `IIS` runs on `APP01`                 | hosts                     | from the host to what runs on it    |
| hosts              | `PVE01` hosts `VM12`                  | runs on                   | from the host to what it hosts      |
| depends on         | `Portal` depends on `AuthAPI`         | required by               | from `AuthAPI` to `Portal`          |
| connects to        | `APP01` connects to `SQL01`           | receives connections from | from `SQL01` to `APP01`             |
| uses database      | `CustomerAPI` uses database `SQL01`   | database for              | from the database to its users      |
| authenticates with | `Portal` authenticates with `AD`      | authenticates             | from `AD` to `Portal`               |
| exposed through    | `Portal` exposed through `Cloudflare` | exposes                   | from `Cloudflare` to `Portal`       |
| stores data in     | `App` stores data in `S3 bucket`      | stores data for           | from the storage to the app         |
| calls              | `Web` calls `CustomerAPI`             | called by                 | from the API to its callers         |
| listens on         | `IIS` listens on `NET-DMZ`            | has listener              | from the network to the listener    |
| backs up to        | `SQL01` backs up to `NAS01`           | backup target for         | informational — not used for impact |
| monitored by       | `APP01` monitored by `Zabbix`         | monitors                  | informational — not used for impact |
| related to         | —                                     | related to                | informational — not used for impact |

Prefer **runs on** over **hosts** for the same pair, and never store both.
Detected connections start as **connects to**; when you confirm them you
can pick a more precise type (for example _uses database_ for port 1433).
