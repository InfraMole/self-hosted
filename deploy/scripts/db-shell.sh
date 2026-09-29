#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-only
# The only sanctioned way for platform staff to open a database session in
# production (docs/DEPLOYMENT.md §8). Every session is recorded BEFORE it
# opens: an audit_event (actorType OPERATOR, action operator.db_access, the
# reason) and a line in deploy/access.log. This is accountability, not a hard
# control — anyone with root on the host can bypass it — so combine it with
# host access control (few people, SSH keys, host logs).
#   ./deploy/scripts/db-shell.sh "investigating ticket #123: failed import"
#   ./deploy/scripts/db-shell.sh "count workspaces" -c 'select count(*) from workspace'
set -eu
reason="${1:-}"
[ "${#reason}" -ge 10 ] || { echo 'usage: db-shell.sh "<reason, 10+ chars>" [psql args…]' >&2; exit 1; }
shift
operator="${DEPMAP_OPERATOR:-$(id -un 2>/dev/null || echo unknown)@$(hostname)}"
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
# Repository layout (deploy/) or the self-hosted bundle.
cf=docker-compose.prod.yml; [ -f "$cf" ] || cf=docker-compose.yml
compose="docker compose -f $cf --env-file .env"

# psql variables (:'op', :'reason') are quoted by psql itself: no injection.
$compose exec -T db psql -U depmap -d depmap -v ON_ERROR_STOP=1 -v op="$operator" -v reason="$reason" -q <<'SQL'
INSERT INTO audit_event (id, "workspaceId", "actorType", "actorLabel", action, metadata)
VALUES (gen_random_uuid()::text, NULL, 'OPERATOR', :'op', 'operator.db_access',
        jsonb_build_object('reason', :'reason'));
SQL
printf '%s\t%s\topened\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$operator" "$reason" >> "$here/access.log"

status=0
if [ -t 0 ]; then
  $compose exec db psql -U depmap -d depmap "$@" || status=$?
else
  $compose exec -T db psql -U depmap -d depmap "$@" || status=$?
fi
printf '%s\t%s\tclosed\t(exit %s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$operator" "$status" >> "$here/access.log"
exit "$status"
