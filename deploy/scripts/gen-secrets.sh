#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-only
# Fresh production secrets (docs/DEPLOYMENT.md, content/self-hosted.md).
#   ./scripts/gen-secrets.sh .env   fills every EMPTY secret in .env in place
#                                   (existing values are never overwritten)
#   ./scripts/gen-secrets.sh        prints them in .env format instead
set -eu
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

gen() {
  case "$1" in
    POSTGRES_PASSWORD | APP_DB_PASSWORD) openssl rand -hex 24 ;;
    BETTER_AUTH_SECRET) openssl rand -base64 48 | tr -d '\n' ;;
    CREDENTIALS_ENCRYPTION_KEY) openssl rand -base64 32 | tr -d '\n' ;;
    CRON_SECRET) openssl rand -hex 32 ;;
  esac
}
keys="POSTGRES_PASSWORD APP_DB_PASSWORD BETTER_AUTH_SECRET CREDENTIALS_ENCRYPTION_KEY CRON_SECRET"

if [ $# -eq 0 ]; then
  for k in $keys; do echo "$k=$(gen "$k")"; done
  exit 0
fi

file="$1"
[ -f "$file" ] || { echo "not found: $file (copy .env.example first)" >&2; exit 1; }
umask 077
tmp="$(mktemp)"
cp "$file" "$tmp"
for k in $keys; do
  if grep -q "^$k=..*" "$tmp"; then
    echo "kept   $k (already set)"
  elif grep -q "^$k=$" "$tmp"; then
    v="$(gen "$k")"
    # Values are base64/hex: no characters that need escaping for awk.
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k && $2=="" {print k "=" v; next} {print}' "$tmp" > "$tmp.new"
    mv "$tmp.new" "$tmp"
    echo "filled $k"
  else
    echo "$k=$(gen "$k")" >> "$tmp"
    echo "added  $k"
  fi
done
cat "$tmp" > "$file"
rm -f "$tmp"
chmod 600 "$file" 2>/dev/null || true
