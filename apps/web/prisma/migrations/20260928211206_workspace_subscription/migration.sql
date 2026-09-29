-- CreateTable
CREATE TABLE "workspace_subscription" (
    "workspaceId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'none',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_subscription_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscription_stripeCustomerId_key" ON "workspace_subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_subscription_stripeSubscriptionId_key" ON "workspace_subscription"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "workspace_subscription" ADD CONSTRAINT "workspace_subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (ADR-020): tenant-scoped like every workspace table.
ALTER TABLE workspace_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_subscription
  USING (app_bypass() OR "workspaceId" = app_workspace())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());
