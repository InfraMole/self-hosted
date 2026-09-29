-- Row Level Security as a second tenant barrier (M8c, ADR-020).
--
-- The application connects as `depmap_app` (no superuser, no BYPASSRLS) in
-- production and in integration tests. Migrations run as the owner role and
-- are not subject to these policies (RLS is ENABLEd, not FORCEd).
-- server/db.ts sets, per transaction (SET LOCAL semantics):
--   app.workspace_id  the tenant of tenantDb(ctx)
--   app.user_id       the signed-in user (userDb / tenantDb)
--   app.bypass_rls    'on' only for systemDb("<reason>") — cross-tenant jobs
-- No setting = no rows: a query that forgets its scope fails closed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'depmap_app') THEN
    CREATE ROLE depmap_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO depmap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO depmap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO depmap_app;
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM depmap_app;
  END IF;
END
$$;
-- Tables created by later migrations (run by the owner) are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO depmap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO depmap_app;

CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;
CREATE OR REPLACE FUNCTION app_workspace() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.workspace_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_user() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- Plain tenant tables: rows of the scoped workspace only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'resource', 'relationship', 'relationship_evidence', 'enrollment_token', 'agent',
    'observation', 'connection_fact', 'integration', 'invitation', 'change_event'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR "workspaceId" = app_workspace()) '
      'WITH CHECK (app_bypass() OR "workspaceId" = app_workspace())', t);
  END LOOP;
END
$$;

-- Memberships: the scoped workspace's members, plus the user's own memberships
-- (to list "my workspaces" and resolve a workspace by slug).
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON membership;
CREATE POLICY tenant_isolation ON membership
  USING (app_bypass() OR "workspaceId" = app_workspace() OR "userId" = app_user())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());

-- Workspaces: the scoped one, or any the user is a member of.
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workspace;
CREATE POLICY tenant_isolation ON workspace
  USING (
    app_bypass() OR id = app_workspace()
    OR EXISTS (SELECT 1 FROM membership m WHERE m."workspaceId" = workspace.id AND m."userId" = app_user())
  )
  WITH CHECK (app_bypass() OR id = app_workspace());

-- Audit: workspace events of the scoped workspace; account-level events
-- (workspaceId NULL) only of the scoped user.
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_event;
CREATE POLICY tenant_isolation ON audit_event
  USING (app_bypass() OR "workspaceId" = app_workspace() OR ("workspaceId" IS NULL AND "actorId" = app_user()))
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace() OR ("workspaceId" IS NULL AND "actorId" = app_user()));
