-- AlterEnum
ALTER TYPE "EvidenceKind" ADD VALUE 'DB_SESSION';

-- DropIndex
DROP INDEX "connection_fact_agentId_direction_remoteIp_port_processName_key";

-- AlterTable
ALTER TABLE "connection_fact" ADD COLUMN     "site" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "connection_fact_agentId_direction_remoteIp_port_processName_key" ON "connection_fact"("agentId", "direction", "remoteIp", "port", "processName", "site");

