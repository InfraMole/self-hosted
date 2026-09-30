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

**Large maps**: above 300 visible resources the map uses a faster,
simplified layout (dependents still above what they need, wide rows
wrapped) and says so. Double-click a resource to focus on it, or filter by
type or environment, for the detailed layout.

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
