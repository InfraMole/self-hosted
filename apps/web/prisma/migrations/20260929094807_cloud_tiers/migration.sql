-- AlterTable
ALTER TABLE "workspace" ADD COLUMN     "overLimitSince" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workspace_subscription" ADD COLUMN     "tier" TEXT;

