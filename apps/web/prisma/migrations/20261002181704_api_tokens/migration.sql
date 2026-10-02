-- CreateTable
CREATE TABLE "api_token" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_token_tokenHash_key" ON "api_token"("tokenHash");

-- CreateIndex
CREATE INDEX "api_token_workspaceId_createdAt_idx" ON "api_token"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (ADR-020): tenant-scoped like every workspace table.
-- Authentication looks tokens up by hash through systemDb (like agent secrets).
ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_token
  USING (app_bypass() OR "workspaceId" = app_workspace())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());
