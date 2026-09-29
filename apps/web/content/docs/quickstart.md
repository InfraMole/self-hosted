# Quickstart

From zero to a first dependency map in about fifteen minutes.

:::steps

### Get an InfraMole server

Choose one:

- **InfraMole Cloud**: [create an account](/sign-up). Every workspace starts
  with a 14-day free trial of the Team plan, no card needed.
- **Self-hosted**: follow [Install on Linux](/docs/installation/linux) or
  [Install on Windows](/docs/installation/windows), then open
  `https://<your domain>/sign-up`.

### Create your workspace

After signing up, give the workspace a name (for example your company or a
client). You are its **owner**. Colleagues can be invited later from
**Settings › Members**.

### Add your first servers

The empty Library shows three ways to start. Use any of them:

- **Install the agent** on one or two servers that talk to each other (for
  example a web server and its database). See
  [Install the agent](/docs/agent/install).
- **Connect a cloud** in **Settings › Integrations** (Azure, AWS or
  Cloudflare) with a read-only token. See
  [Cloud integrations](/docs/manual/integrations).
- **Import a file**: a CSV with your servers, a docker-compose file or a
  Proxmox export. See [Import files](/docs/manual/imports).

### Review the suggestions

After a few minutes, agents report the connections they observe. Open
**Suggestions** and, for each detected relationship, choose **Confirm**,
**Add context** (change the type, add a note) or **Ignore**.

### Explore the map and the impact

Open **Map** to see everything connected. Select a resource and click
**Impact** to see what could be affected if it disappeared — with how
certain each path is.

:::

:::tip Start small
Two or three servers that you know well are the best start: you can check
every suggestion against what you already know, and see how InfraMole
presents certainty.
:::
