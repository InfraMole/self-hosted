-- CreateEnum
CREATE TYPE "SsoProtocol" AS ENUM ('OIDC', 'SAML', 'LDAP');

-- CreateTable
CREATE TABLE "sso_provider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,
    "domainVerified" BOOLEAN,

    CONSTRAINT "sso_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_sso" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "protocol" "SsoProtocol" NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "defaultRole" "MembershipRole",
    "groupsClaim" TEXT NOT NULL DEFAULT 'groups',
    "groupRoles" JSONB NOT NULL DEFAULT '[]',
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ldapCiphertext" TEXT,
    "ldapIv" TEXT,
    "ldapKeyVersion" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_sso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_provider_providerId_key" ON "sso_provider"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sso_providerId_key" ON "workspace_sso"("providerId");

-- One verified connection per email domain across the installation (partial:
-- an unverified claim never blocks the domain's real owner). Not in schema.prisma.
CREATE UNIQUE INDEX "workspace_sso_verified_domain_key" ON "workspace_sso"("domain") WHERE "domainVerified";

-- CreateIndex
CREATE INDEX "workspace_sso_workspaceId_idx" ON "workspace_sso"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sso_workspaceId_id_key" ON "workspace_sso"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_sso" ADD CONSTRAINT "workspace_sso_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security (ADR-020): workspace_sso is tenant data. sso_provider is
-- an auth table (like account): no tenant column, no RLS; InfraMole only
-- reaches it through Better Auth and the SSO module.
ALTER TABLE workspace_sso ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_sso
  USING (app_bypass() OR "workspaceId" = app_workspace())
  WITH CHECK (app_bypass() OR "workspaceId" = app_workspace());
