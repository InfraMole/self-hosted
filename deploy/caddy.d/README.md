# Extra sites

Files named *.caddy in this folder are added to the Caddyfile (see its last
lines), so Caddy can publish other apps on this host next to InfraMole.
Upgrades never replace them. After a change: docker compose restart caddy
