-- CreateTable
CREATE TABLE "saved_view" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_view_workspaceId_name_key" ON "saved_view"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (ADR-020): tenant-scoped like every workspace table.
ALTER TABLE saved_view ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_view
  USING (app_bypass() OR "workspaceId" = app_workspace())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());
