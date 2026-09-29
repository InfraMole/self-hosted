-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM', 'OPERATOR');

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_event_workspaceId_createdAt_idx" ON "audit_event"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_event_actorId_createdAt_idx" ON "audit_event"("actorId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only guard (M8c): no UPDATE ever; DELETE only past the 365-day
-- retention or inside a transaction that sets depmap.allow_audit_delete
-- (workspace deletion, which cascades).
CREATE FUNCTION audit_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_event is append-only';
  END IF;
  IF OLD."createdAt" > now() - interval '365 days'
     AND coalesce(current_setting('depmap.allow_audit_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_event rows are kept for 365 days';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_guard();
