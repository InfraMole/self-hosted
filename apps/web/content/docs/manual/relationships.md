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
  traffic). Ignored pairs are never suggested again.

Members, admins and owners can review; viewers can read.

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
