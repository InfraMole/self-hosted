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

The search box matches names, descriptions, owners, hostnames, exact tags
and exact IP addresses. Anywhere in a workspace, **Ctrl K** (⌘K on a Mac)
opens a quick search over resources and pages: Enter opens the resource,
Alt+Enter shows it on the map. Filters narrow by type, environment, status and **source** —
who created the resource: a person, an agent, an integration or a file
import.

**Sort** by clicking a column header (click again to reverse it). Large
inventories are split into pages of 100; the count and **Next** /
**Previous** are under the table. Filters, sorting and the page are in the
address, so a link opens the same list.

## Add and edit

- **Add resource** opens a form; only the name and type are required.
- Click a resource to open its page: **Overview** (details, observed
  connections), **Dependencies** (relationships in both directions) and
  **Activity** (every change, with who made it).
- If a resource with the same name already exists (in any case, even
  archived), InfraMole shows it and asks before creating another one —
  **Create anyway** when two of them are legitimate (two clients' `web01`).
- Members, admins and owners can edit; viewers can only read.

## Owners

Give a resource an **owner** — a person or a team — and a **contact** (an
email, a phone, a chat channel). The impact of any resource then lists **who
to warn**: the owners of what could be affected, with a message you can copy
into a change request. Set owners one by one with **Edit**, for many
resources at once with **Set owner…** (below), or with `owner` /
`owner_contact` columns in an [import](/docs/manual/imports).

## Bulk actions

Tick rows to **archive**, **delete** or **set the owner** of several
resources at once (up to 500). The selection is per page.
Deleting also removes their relationships; the delete dialog offers
**Archive instead**.

## Resources from a removed source

When an integration is deleted or you want to undo a file import, filter the
Library by that source and use **Retire them…**: resources nobody touched
are deleted, and those with notes, edits or confirmed relationships are
archived, so their context is kept. Resources that existed before the
source are never affected.
