-- CreateEnum
CREATE TYPE "ConnectionDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('TCP_CONNECTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChangeKind" ADD VALUE 'DISCOVERED';
ALTER TYPE "ChangeKind" ADD VALUE 'CONFIRMED';
ALTER TYPE "ChangeKind" ADD VALUE 'IGNORED';

-- CreateTable
CREATE TABLE "connection_fact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sourceResourceId" TEXT NOT NULL,
    "direction" "ConnectionDirection" NOT NULL,
    "remoteIp" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "processName" TEXT NOT NULL DEFAULT '',
    "remoteResourceId" TEXT,
    "sampleCount" INTEGER NOT NULL,
    "reportCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connection_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationship_evidence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL DEFAULT 'TCP_CONNECTION',
    "connectionFactId" TEXT,
    "port" INTEGER NOT NULL,
    "protocolGuess" TEXT,
    "processName" TEXT,
    "sampleCount" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connection_fact_workspaceId_remoteResourceId_idx" ON "connection_fact"("workspaceId", "remoteResourceId");

-- CreateIndex
CREATE INDEX "connection_fact_sourceResourceId_idx" ON "connection_fact"("sourceResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "connection_fact_agentId_direction_remoteIp_port_processName_key" ON "connection_fact"("agentId", "direction", "remoteIp", "port", "processName");

-- CreateIndex
CREATE INDEX "relationship_evidence_workspaceId_idx" ON "relationship_evidence"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_evidence_relationshipId_connectionFactId_key" ON "relationship_evidence"("relationshipId", "connectionFactId");

-- AddForeignKey
ALTER TABLE "connection_fact" ADD CONSTRAINT "connection_fact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_fact" ADD CONSTRAINT "connection_fact_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_fact" ADD CONSTRAINT "connection_fact_sourceResourceId_fkey" FOREIGN KEY ("sourceResourceId") REFERENCES "resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_fact" ADD CONSTRAINT "connection_fact_remoteResourceId_fkey" FOREIGN KEY ("remoteResourceId") REFERENCES "resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_evidence" ADD CONSTRAINT "relationship_evidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_evidence" ADD CONSTRAINT "relationship_evidence_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship_evidence" ADD CONSTRAINT "relationship_evidence_connectionFactId_fkey" FOREIGN KEY ("connectionFactId") REFERENCES "connection_fact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
