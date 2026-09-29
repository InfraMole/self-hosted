-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('RUNS_ON', 'HOSTS', 'DEPENDS_ON', 'CONNECTS_TO', 'USES_DATABASE', 'AUTHENTICATES_WITH', 'EXPOSED_THROUGH', 'STORES_DATA_IN', 'BACKS_UP_TO', 'MONITORED_BY', 'CALLS', 'LISTENS_ON', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipOrigin" AS ENUM ('MANUAL', 'DETECTED', 'INFERRED');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('CONFIRMED', 'UNCONFIRMED', 'IGNORED');

-- AlterTable
ALTER TABLE "change_event" ADD COLUMN     "resourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "relationship" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromResourceId" TEXT NOT NULL,
    "toResourceId" TEXT NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "origin" "RelationshipOrigin" NOT NULL DEFAULT 'MANUAL',
    "status" "RelationshipStatus" NOT NULL DEFAULT 'CONFIRMED',
    "note" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "firstObservedAt" TIMESTAMP(3),
    "lastObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "relationship_workspaceId_toResourceId_idx" ON "relationship"("workspaceId", "toResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_workspaceId_fromResourceId_toResourceId_type_key" ON "relationship"("workspaceId", "fromResourceId", "toResourceId", "type");

-- CreateIndex
CREATE INDEX "change_event_resourceIds_idx" ON "change_event" USING GIN ("resourceIds");

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_workspaceId_fromResourceId_fkey" FOREIGN KEY ("workspaceId", "fromResourceId") REFERENCES "resource"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_workspaceId_toResourceId_fkey" FOREIGN KEY ("workspaceId", "toResourceId") REFERENCES "resource"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariant: no self-loops (docs/DATA_MODEL.md §4).
ALTER TABLE "relationship" ADD CONSTRAINT "relationship_no_self_loop" CHECK ("fromResourceId" <> "toResourceId");
