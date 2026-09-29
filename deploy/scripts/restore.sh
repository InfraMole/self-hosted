#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-only
# Restores a backup produced by the `backup` service (docs/DEPLOYMENT.md §5).
#   ./deploy/scripts/restore.sh depmap-20260928T020000Z.dump
#   ./deploy/scripts/restore.sh depmap-20260928T020000Z.dump.age /secure/path/age-key.txt
# The file must be in deploy/backups/ (mounted in the backup container, so the
# dump never passes through the host shell; MSYS_NO_PATHCONV keeps Git Bash
# on Windows from rewriting container paths). Encrypted (.age) dumps need the
# age private key, copied into the container only for the duration of the
# restore. Stops the app, replaces the database contents, starts the app again.
set -eu
name="$(basename "${1:?usage: restore.sh <file.dump[.age] in deploy/backups> [age-key-file]}")"
key="${2:-}"
here="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$here/backups/$name" ] || { echo "not found: backups/$name" >&2; exit 1; }
case "$name" in
  *.age) [ -n "$key" ] && [ -f "$key" ] || { echo "encrypted dump: pass the age key file as 2nd argument" >&2; exit 1; } ;;
esac
cd "$here"
# Repository layout (deploy/) or the self-hosted bundle.
cf=docker-compose.prod.yml; [ -f "$cf" ] || cf=docker-compose.yml
compose="docker compose -f $cf --env-file .env"
restore="pg_restore -h db -U depmap -d depmap --clean --if-exists --no-owner"

$compose stop web cron
case "$name" in
  *.age)
    MSYS_NO_PATHCONV=1 $compose cp "$key" backup:/tmp/restore-key
    MSYS_NO_PATHCONV=1 $compose exec -T backup sh -c \
      "trap 'rm -f /tmp/restore-key' EXIT; age -d -i /tmp/restore-key '/backups/$name' | $restore"
    ;;
  *)
    MSYS_NO_PATHCONV=1 $compose exec -T backup $restore "/backups/$name"
    ;;
esac
$compose up -d web cron
echo "restored $name"
