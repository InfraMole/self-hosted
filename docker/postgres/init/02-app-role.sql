-- SPDX-License-Identifier: AGPL-3.0-only
-- Local development only: the RLS-restricted runtime role (ADR-020) with a
-- known dev password. Production sets its own password (deploy/, DEPLOYMENT.md).
-- The row_level_security migration grants its privileges.
CREATE ROLE depmap_app LOGIN PASSWORD 'depmap_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
