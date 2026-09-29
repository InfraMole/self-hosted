-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "enrollment_token" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT,
    "machineId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "reportIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schemaVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadBytes" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "observation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_token_tokenHash_key" ON "enrollment_token"("tokenHash");

-- CreateIndex
CREATE INDEX "enrollment_token_workspaceId_createdAt_idx" ON "enrollment_token"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_secretHash_key" ON "agent"("secretHash");

-- CreateIndex
CREATE UNIQUE INDEX "agent_workspaceId_machineId_key" ON "agent"("workspaceId", "machineId");

-- CreateIndex
CREATE INDEX "observation_agentId_receivedAt_idx" ON "observation"("agentId", "receivedAt");

-- CreateIndex
CREATE INDEX "observation_workspaceId_receivedAt_idx" ON "observation"("workspaceId", "receivedAt");

-- AddForeignKey
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation" ADD CONSTRAINT "observation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation" ADD CONSTRAINT "observation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
