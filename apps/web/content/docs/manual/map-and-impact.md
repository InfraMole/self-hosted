# Map and impact

## The map

**Map** draws every resource and relationship of the workspace, laid out
automatically: resources that depend on others are placed **above** what
they need, and arrows point at what is needed.

- **Filters**: resource type, environment, and toggles for **Unconfirmed**
  (detected and inferred suggestions) and **Informational** relationships
  (those that do not carry failures, like _backs up to_ or _monitored by_).
- **Focus**: select a resource to show only its neighbourhood, choosing the
  direction (what it needs, what needs it, or both) and the depth.
- **Inspector**: the side panel shows the selected resource or relationship,
  with links to its page.

**How it is laid out**: the map reads like a stack, top to bottom —
entry points (CDN, domains, load balancers), applications, services,
databases and storage, VMs and containers, and servers at the bottom. A
resource is never above what depends on it, so arrows point down to what
something needs; _exposed through_ is the exception, drawn up to the proxy
in front (the path a request takes). Separate groups of related resources
are laid out side by side, and resources without relationships are
gathered in a small grid.

**Servers as boxes**: what runs on a single server, VM or host — sites,
databases, containers, VMs on a hypervisor — is drawn inside it, so
placement needs no arrows. Maps with more than 25 resources open with the
boxes collapsed (a server shows **+N**, what it contains); click **+N** to
open one, or **Expand all** / **Collapse all**. Relationships of what is
inside a collapsed box are drawn to the box, and say what they stand for
when you select either end (for example "Billing uses database
CustomersDB"); a line that stands for several shows **×2**. Relationships
between two things inside the same collapsed box are not drawn: the box
counts them next to **+N**, and selecting it lists what it contains and
those relationships. A workload that runs on several
nodes stays outside. Focus and impact always show everything.

**Large maps** open on their main group at a readable size; use the
minimap, the fit button or zoom to see the rest. Double-click a resource to
focus on it, or filter by type or environment.

Line styles follow the [certainty encoding](/docs/manual/relationships#how-certain-is-it):
solid for confirmed, dashed for detected, dotted for inferred.

## Impact

Impact answers **"what could be affected if this disappears?"**. Open it
from a resource page (**Impact**) or from the map inspector.

InfraMole follows relationships in the direction failures travel: if
`Portal` depends on `AuthAPI`, a failure of `AuthAPI` could affect `Portal`.
For every affected resource it shows:

- **how certain** the path is — a path is only as certain as its weakest
  link, and the strongest possible path is chosen;
- **how many hops** away it is, and the path itself.

The headline reads _"If SQL01 fails, N resources could be affected"_, with
counts by type and by certainty. Use **Max depth** to limit how far it
looks. The impact page has its own address, so you can share it before a
maintenance window.

:::warning Could, not will
Impact describes what **could** be affected according to the relationships
you have. Missing or unconfirmed relationships mean the real impact can be
larger or smaller. Confirm the suggestions that matter to make it reliable.
:::

Archived resources and ignored relationships are left out of both the map
and impact.

## Export a map or an impact

**Export PNG** or **PDF** in the map toolbar saves exactly what is on
screen: the whole map, the current filters, a focused resource or an impact
view. The file has a white background for printing and sharing, with a
title (workspace and view), the date, the legend of line styles and, for
impact, which resource fails and what could be affected. A note at the
bottom says that detected and inferred relationships are suggestions.

The file is drawn in your browser: the map is not sent anywhere to create
it. Very large maps are exported at a lower resolution so the browser can
handle them.
