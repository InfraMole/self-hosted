-- CreateTable
CREATE TABLE "discovery_rule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "port" INTEGER,
    "processName" TEXT,
    "resourceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_rule_workspaceId_idx" ON "discovery_rule"("workspaceId");

-- AddForeignKey
ALTER TABLE "discovery_rule" ADD CONSTRAINT "discovery_rule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_rule" ADD CONSTRAINT "discovery_rule_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rule must narrow something: at least one criterion (ADR-027).
ALTER TABLE "discovery_rule" ADD CONSTRAINT "discovery_rule_has_criterion"
  CHECK ("port" IS NOT NULL OR "processName" IS NOT NULL OR "resourceId" IS NOT NULL);

-- Row Level Security (ADR-020): tenant-scoped like every workspace table.
ALTER TABLE discovery_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discovery_rule
  USING (app_bypass() OR "workspaceId" = app_workspace())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());
