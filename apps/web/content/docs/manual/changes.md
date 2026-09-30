# Changes

**Changes** answers "what changed?" across the workspace. Every change is
recorded with who made it (a person, an agent, an import or the system) and
when.

## What is recorded

- Resources and relationships created, edited, archived or deleted.
- Suggestions confirmed or ignored.
- Hosts discovered by agents, and what changed on them since the previous
  report: IP addresses, services started or stopped, listening ports opened
  or closed.
- Resources that stopped being observed (**Stale**) and came back.
- Imports and integration syncs.

## Browse

- **Period**: last 24 hours, 7 days or 30 days.
- **Actor**: everyone, people, agents or system.
- **Kind**: click a summary chip (created, updated, discovered…) to filter.

Entries are grouped by day and link to the resource when it still exists.
Each resource page also has its own **Activity** tab.

## Weekly summary by email

In **Account & security › Weekly summary** each person can turn on, per
workspace, an email every Monday with what changed in the previous week:
how many resources were created, discovered, changed or stopped reporting,
the most changed resources, and how many suggestions wait for review. It is
a summary, not an alert, and it never includes IP addresses or change
details. Weeks without anything to report send nothing.

It needs email to be configured on the server
([Configuration](/docs/installation/configuration#email)). Every email has
an **unsubscribe** link that works without signing in.

## How long it is kept

Change history is kept for 365 days on self-hosted installations. On
InfraMole Cloud (planned) it will depend on the plan. The separate
**audit log** (security events) is described in
[Members and security](/docs/manual/members-and-security#audit-log).
