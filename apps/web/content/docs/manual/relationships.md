# Relationships and suggestions

A relationship says how two resources are connected, for example
`CustomerAPI` **uses database** `SQL01`. Relationships have a direction and a
type (see [Relationship types](/docs/reference/relationship-types)).

## Where relationships come from

| Origin       | Created by                                                | Status when created                                                                       |
| ------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Manual**   | A person                                                  | Confirmed                                                                                 |
| **Detected** | An agent (observed connection) or an import / integration | Unconfirmed suggestion — some imports create confirmed ones (for example Proxmox _hosts_) |
| **Inferred** | A reasonable guess                                        | Unconfirmed suggestion                                                                    |

## How certain is it

InfraMole always shows how sure it is, with the same encoding everywhere:

|               | Map line        | Badge          |
| ------------- | --------------- | -------------- |
| **Confirmed** | solid           | solid          |
| **Detected**  | dashed          | dashed outline |
| **Inferred**  | dotted, fainter | dotted outline |

Only **confirmed** relationships are presented as dependencies. Detected and
inferred ones are shown as what they are: suggestions.

## Review suggestions

**Suggestions** lists the detected relationships waiting for review, with
their evidence: port, likely protocol (for example _MSSQL_ for 1433), the
process that made the connection and how many times it was seen.

For each one:

- **Confirm** — it is real.
- **Confirm as "uses database"** (or another suggested type) — real, with a
  more precise type.
- **Add context** — choose the type, add a note, then confirm.
- **Ignore** — it is not a dependency (for example backup or monitoring
  traffic). Ignored pairs are not suggested again.

Members, admins and owners can review; viewers can read.

### Review many at once

With agents on many servers, the list grows quickly. Filter it by
**destination**, **port** or **process**, tick **Select all**, then:

- **Confirm** — confirm them as they are;
- **Confirm with suggested types** — each one takes the type its port
  suggests (1433 → _uses database_, 389 → _authenticates with_…);
- **Ignore** — ignore them all.

Up to 1,000 suggestions are listed at a time.

### Undo an ignore

Ignored suggestions are kept in the **Ignored** tab. Select them and choose
**Restore** to put them back in the inbox.

### Always ignore some traffic

Some connections are never dependencies: backup agents, antivirus updates,
monitoring. Filter the inbox by that port, process or destination and choose
**Always ignore this traffic…**, or add a rule in the **Rules** tab. A rule
can combine a port, a process name and a resource (either end of the
connection); every field you fill in must match.

Adding a rule removes the matching suggestions still waiting for review, and
agents' future reports never turn that traffic into suggestions. Confirmed
relationships are never changed. Delete the rule and the traffic can be
suggested again straight away. Adding and removing rules is recorded in the
audit log.

### Suggested rules

The **Rules** tab also offers ready-made rules for traffic that is almost
never a dependency: backup software (Veeam, NetBackup, Commvault, Bacula,
Acronis), antivirus and EDR consoles (ESET, Sophos, Trend Micro,
Kaspersky), monitoring agents (Zabbix, Nagios / Icinga, Prometheus
exporters, Checkmk, PRTG, Munin) and remote administration (RDP, SSH,
WinRM). Each one shows the ports it covers and how many of your current
suggestions it would remove. Nothing is applied until you click **Add**, and
every rule can be removed like one you wrote.

### Suggestions that go away

A suggestion that no agent has observed for **30 days** is removed
automatically, and the Changes history says so. Suggestions created by an
import do not expire.

## Add a relationship by hand

On a resource page, open **Dependencies › Add relationship**, pick the
other resource and the type. Manual relationships are confirmed.

## Why a connection may not appear

- It was seen fewer than twice, or only in one short window (nightly jobs).
- The remote IP is unknown, or belongs to more than one resource. Add the
  IP to the right resource and the suggestion appears on the next report.
  Unknown endpoints are listed on the host's **Overview** under
  _Observed on this host_.
- It goes through NAT, a load balancer or a proxy, which hide the real peer.
