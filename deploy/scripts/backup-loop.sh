#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# Nightly PostgreSQL backups of the InfraMole database (backup service).
# - a dump at start, then every 24 h, kept BACKUP_KEEP_DAYS days in /backups;
# - encrypted with age when BACKUP_AGE_RECIPIENT is set;
# - optionally copied off the host to S3-compatible storage (BACKUP_S3_*),
#   only when encrypted, and pruned there after the same number of days.
# BACKUP_ONCE=1 runs a single backup and exits with its status (tests, manual
# runs). A failed dump is never kept, uploaded or counted as a backup, and
# nothing is pruned after a failure.
set -u
# Without pipefail, `pg_dump | age` reports age's status: a failed dump
# would become an "encrypted backup" of nothing (busybox ash supports it).
set -o pipefail || {
  echo "ERROR: this shell has no pipefail - refusing to run backups"
  exit 1
}
umask 077
KEEP="${BACKUP_KEEP_DAYS:-14}"

offsite() {
  file="$1"
  [ -n "${BACKUP_S3_BUCKET:-}" ] || return 0
  if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
    echo "ERROR: off-host backups need BACKUP_AGE_RECIPIENT - nothing uploaded (dumps never leave the host unencrypted)"
    return 1
  fi
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
  export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-}"
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
  # Keys limited to one bucket cannot create or list buckets.
  export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  target="offsite:${BACKUP_S3_BUCKET}${BACKUP_S3_PREFIX:+/$BACKUP_S3_PREFIX}"
  if rclone copyto --retries 3 "$file" "$target/$(basename "$file")"; then
    echo "uploaded $(basename "$file") to $target"
  else
    echo "ERROR: upload to $target failed"
    return 1
  fi
  rclone delete --min-age "${KEEP}d" --include 'depmap-*.dump.age' "$target" ||
    echo "WARNING: could not prune old copies in $target"
}

once() {
  f="/backups/depmap-$(date -u +%Y%m%dT%H%M%SZ).dump"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    out="$f.age"
    note=" (encrypted)"
    pg_dump -h db -U depmap -d depmap -Fc | age -r "$BACKUP_AGE_RECIPIENT" -o "$out.tmp"
    status=$?
  else
    echo "WARNING: BACKUP_AGE_RECIPIENT unset - backup is NOT encrypted"
    out="$f"
    note=""
    pg_dump -h db -U depmap -d depmap -Fc -f "$out.tmp"
    status=$?
  fi
  if [ "$status" -ne 0 ] || ! mv "$out.tmp" "$out"; then
    rm -f "$out.tmp"
    echo "ERROR: backup failed (exit $status) - previous backups kept, nothing pruned"
    return 1
  fi
  echo "backup $out$note"
  find /backups -name 'depmap-*.dump*' -mtime +"$KEEP" -delete
  offsite "$out"
}

while true; do
  once
  status=$?
  [ "${BACKUP_ONCE:-}" = "1" ] && exit "$status"
  sleep 86400
done
