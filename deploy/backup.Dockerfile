# Backup job image: pg_dump (matches the Postgres major), age for encryption,
# rclone (MIT) for optional off-host copies to S3-compatible storage.
FROM postgres:17-alpine
RUN apk add --no-cache age rclone
COPY scripts/backup-loop.sh /usr/local/bin/inframole-backup
RUN chmod 0755 /usr/local/bin/inframole-backup
CMD ["/usr/local/bin/inframole-backup"]
