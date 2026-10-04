-- CreateTable
CREATE TABLE "map_share" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "savedViewId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_share_tokenHash_key" ON "map_share"("tokenHash");

-- CreateIndex
CREATE INDEX "map_share_workspaceId_createdAt_idx" ON "map_share"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_view_workspaceId_id_key" ON "saved_view"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "map_share" ADD CONSTRAINT "map_share_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_share" ADD CONSTRAINT "map_share_workspaceId_savedViewId_fkey" FOREIGN KEY ("workspaceId", "savedViewId") REFERENCES "saved_view"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security (ADR-020): tenant-scoped like every workspace table.
-- The public share page finds a link by its hash through systemDb.
ALTER TABLE map_share ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON map_share
  USING (app_bypass() OR "workspaceId" = app_workspace())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());
