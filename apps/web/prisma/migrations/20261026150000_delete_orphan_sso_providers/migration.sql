-- Deleting a workspace used to leave the SSO plugin's provider rows behind
-- (sealed OIDC client secrets and SAML keys of connections that no longer
-- exist). Deletion now removes them with the workspace; this removes the old
-- ones once. The bypass makes every workspace_sso row visible even if this
-- ever runs as a role subject to row level security.
SELECT set_config('app.bypass_rls', 'on', true);

DELETE FROM "sso_provider" p
WHERE NOT EXISTS (SELECT 1 FROM "workspace_sso" w WHERE w."providerId" = p."providerId");
