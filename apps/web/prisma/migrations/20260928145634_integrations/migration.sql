-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('AZURE', 'AWS', 'CLOUDFLARE');

-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretCiphertext" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretKeyVersion" INTEGER NOT NULL,
    "secretHint" TEXT,
    "syncIntervalHours" INTEGER NOT NULL DEFAULT 6,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncOk" BOOLEAN,
    "lastSyncMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_workspaceId_name_key" ON "integration"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "integration" ADD CONSTRAINT "integration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
