# Library

The Library is the inventory of a workspace: every server, VM, application,
database, domain and service, whether you added it by hand, imported it or
an agent discovered it.

## Resource types

`Server`, `VM`, `Application`, `Windows service`, `Linux service`,
`Database`, `Domain`, `API`, `Storage`, `Network`, `Container`,
`External service` and `Other`.

Each resource can have an environment (production, staging, development,
test), a criticality (low → critical), tags, IP addresses, hostname / FQDN,
OS, version, external links (https only) and free-text notes.

:::note No secrets, ever
Resources only accept the fields above: there is nowhere to store passwords
or keys, on purpose. Notes are plain text.
:::

## Status

| Status         | Meaning                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active**     | Added or confirmed by a person.                                                                                                                           |
| **Discovered** | Created by an agent, integration or import, not reviewed yet.                                                                                             |
| **Stale**      | Its source stopped reporting it (an agent missed three reports, or an integration no longer lists it). It returns to its previous status when seen again. |
| **Archived**   | Kept for history but hidden from the Library and the map.                                                                                                 |

People can set **Active** or **Archived**; Discovered and Stale are set by
discovery only. Nothing is ever deleted automatically.

## Find resources

The search box matches names, descriptions, hostnames, exact tags and exact
IP addresses. Filters narrow by type, environment, status and **source** —
who created the resource: a person, an agent, an integration or a file
import.

## Add and edit

- **Add resource** opens a form; only the name and type are required.
- Click a resource to open its page: **Overview** (details, observed
  connections), **Dependencies** (relationships in both directions) and
  **Activity** (every change, with who made it).
- Members, admins and owners can edit; viewers can only read.

## Bulk actions

Tick rows to **archive** or **delete** several resources at once (up to 500).
Deleting also removes their relationships; the delete dialog offers
**Archive instead**.

## Resources from a removed source

When an integration is deleted or you want to undo a file import, filter the
Library by that source and use **Retire them…**: resources nobody touched
are deleted, and those with notes, edits or confirmed relationships are
archived, so their context is kept. Resources that existed before the
source are never affected.
