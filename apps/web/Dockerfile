# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# ── Dependencies (+ prisma generate via postinstall) ──────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/prisma.config.ts apps/web/
COPY apps/web/prisma apps/web/prisma
RUN pnpm install --frozen-lockfile

# ── Migrations (used by the `migrate` compose service) ────────────────────────
# Applies migrations as the owner, then enables login for the RLS-restricted
# runtime role depmap_app with APP_DB_PASSWORD (ADR-020).
FROM deps AS migrate
COPY apps/web/scripts/set-app-role-password.mjs apps/web/scripts/
CMD ["sh", "-c", "pnpm --filter @depmap/web db:deploy && pnpm --filter @depmap/web db:app-role"]

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @depmap/web build

# ── Runtime: standalone server, non-root ──────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
