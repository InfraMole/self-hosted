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

## How long it is kept

Change history is kept for 365 days on self-hosted installations. On
InfraMole Cloud it depends on the plan (30, 90 or 365 days). The separate
**audit log** (security events) is described in
[Members and security](/docs/manual/members-and-security#audit-log).
