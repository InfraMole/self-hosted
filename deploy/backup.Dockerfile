# Backup job image: pg_dump (matches the Postgres major) + age for encryption.
FROM postgres:17-alpine
RUN apk add --no-cache age
