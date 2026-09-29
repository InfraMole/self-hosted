-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('SERVER', 'VM', 'APPLICATION', 'WINDOWS_SERVICE', 'LINUX_SERVICE', 'DATABASE', 'DOMAIN', 'API', 'STORAGE', 'NETWORK', 'CONTAINER', 'EXTERNAL_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT', 'TEST', 'OTHER');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'DISCOVERED', 'STALE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResourceSource" AS ENUM ('MANUAL', 'AGENT', 'IMPORT');

-- CreateEnum
CREATE TYPE "ChangeActorType" AS ENUM ('USER', 'AGENT', 'IMPORTER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChangeSubjectType" AS ENUM ('RESOURCE', 'RELATIONSHIP', 'AGENT');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('CREATED', 'UPDATED', 'DELETED');

-- CreateTable
CREATE TABLE "resource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "environment" "Environment",
    "criticality" "Criticality",
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "links" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "source" "ResourceSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ChangeActorType" NOT NULL,
    "actorId" TEXT,
    "subjectType" "ChangeSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "diff" JSONB,

    CONSTRAINT "change_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_workspaceId_type_idx" ON "resource"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "resource_workspaceId_name_idx" ON "resource"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "resource_workspaceId_id_key" ON "resource"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_workspaceId_source_externalId_key" ON "resource"("workspaceId", "source", "externalId");

-- CreateIndex
CREATE INDEX "change_event_workspaceId_occurredAt_idx" ON "change_event"("workspaceId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "change_event_workspaceId_subjectType_subjectId_idx" ON "change_event"("workspaceId", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "resource" ADD CONSTRAINT "resource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_event" ADD CONSTRAINT "change_event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
