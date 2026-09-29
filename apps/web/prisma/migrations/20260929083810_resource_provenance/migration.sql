-- AlterTable
ALTER TABLE "resource" ADD COLUMN     "sourceLabel" TEXT,
ADD COLUMN     "sourceRef" TEXT;

-- CreateIndex
CREATE INDEX "resource_workspaceId_sourceRef_idx" ON "resource"("workspaceId", "sourceRef");

-- Backfill provenance (ADR-021) from the change history. Runs as the owner.
-- Agent hosts: the agent that reports them.
UPDATE resource r
SET "sourceRef" = 'agent:' || r."externalId",
    "sourceLabel" = coalesce('Agent on ' || a.hostname, 'Agent')
FROM agent a
WHERE r.source = 'AGENT' AND r."sourceRef" IS NULL AND a.id = r."externalId";

-- Imported resources: who created them (the CREATED event of the resource).
WITH created AS (
  SELECT DISTINCT ON (e."subjectId") e."subjectId", e."workspaceId", e."actorType", e."actorId"
  FROM change_event e
  WHERE e."subjectType" = 'RESOURCE' AND e.kind = 'CREATED'
    AND e."actorType" IN ('IMPORTER', 'AGENT')
  ORDER BY e."subjectId", e."occurredAt"
)
UPDATE resource r
SET "sourceRef" = CASE
      WHEN c."actorType" = 'AGENT' THEN 'collector:' || c."actorId" || ':proxmox'
      WHEN c."actorId" LIKE 'integration:%' THEN coalesce(
        (SELECT 'integration:' || i.id FROM integration i
          WHERE i."workspaceId" = r."workspaceId" AND i.name = substring(c."actorId" from 13)),
        'integration-removed:' || substring(c."actorId" from 13))
      ELSE 'file:' || c."actorId"
    END,
    "sourceLabel" = CASE
      WHEN c."actorType" = 'AGENT' THEN 'Proxmox via agent'
      WHEN c."actorId" LIKE 'integration:%' THEN 'Integration “' || substring(c."actorId" from 13) || '”'
      ELSE upper(c."actorId") || ' import'
    END
FROM created c
WHERE r.source = 'IMPORT' AND r."sourceRef" IS NULL
  AND c."subjectId" = r.id AND c."workspaceId" = r."workspaceId";
