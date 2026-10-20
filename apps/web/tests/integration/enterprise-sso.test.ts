// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enterprise SSO (M33, ADR-048): connections, domain proof, who gets in with
 * which role, SSO-only domains and tenant isolation. The protocols themselves
 * (OIDC, SAML, LDAP) were verified against Keycloak and OpenLDAP; here the
 * decisions InfraMole makes around them are tested without network.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type Role, type WorkspaceContext } from "@/server/authz";
import { SSO_ONLY_MESSAGE, getAuth } from "@/server/auth";
import {
  SsoError,
  createSsoConnection,
  decideSsoSignIn,
  deleteSsoConnection,
  domainProof,
  listSsoConnections,
  provisionSsoUser,
  ssoEnforcedFor,
  ssoForEmail,
  updateSsoConnection,
  verifySsoDomain,
} from "@/server/modules/sso/sso";
import {
  createWorkspace,
  findWorkspaceContextForUser,
} from "@/server/modules/workspaces/workspaces";
import { adminDb, createTestUser, resetDatabase } from "./helpers";

// Set before the env is first read (each test file has its own module registry).
process.env.SSO_TRUSTED_DOMAINS = "uni.example";
delete process.env.SSO_TRUSTED_ORIGINS;

beforeEach(resetDatabase);
afterAll(() => adminDb().$disconnect());

async function ownerContext(name: string): Promise<WorkspaceContext> {
  const user = await createTestUser(name);
  const ws = await createWorkspace(user.id, { name });
  return (await findWorkspaceContextForUser(user.id, ws.slug))!;
}

async function memberContext(owner: WorkspaceContext, role: Role) {
  const user = await createTestUser(`${role} user`);
  await adminDb().membership.create({
    data: { workspaceId: owner.workspaceId, userId: user.id, role },
  });
  return (await findWorkspaceContextForUser(user.id, owner.workspaceSlug))!;
}

const IDP_METADATA = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.uni.example/realms/uni">
  <IDPSSODescriptor WantAuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.uni.example/saml"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

function saml(domain: string, extra: Record<string, unknown> = {}) {
  return {
    protocol: "SAML",
    name: "University login",
    domain,
    idpMetadata: IDP_METADATA,
    groupRules: "it-admins = admin\nservice-desk = viewer",
    ...extra,
  };
}

async function userWithEmail(email: string) {
  const user = await createTestUser(email);
  return adminDb().user.update({ where: { id: user.id }, data: { email } });
}

describe("connections", () => {
  it("owners manage, admins only see; secrets never reach the view", async () => {
    const owner = await ownerContext("Uni");
    const admin = await memberContext(owner, "ADMIN");
    await expect(createSsoConnection(admin, saml("uni.example"))).rejects.toThrow(ForbiddenError);
    await createSsoConnection(owner, saml("uni.example"));

    const [view] = await listSsoConnections(admin);
    expect(view).toMatchObject({ protocol: "SAML", domain: "uni.example", domainVerified: true });
    expect(view!.spCertificate).toContain("BEGIN CERTIFICATE");
    expect(JSON.stringify(view)).not.toContain("PRIVATE KEY");
    const member = await memberContext(owner, "MEMBER");
    await expect(listSsoConnections(member)).rejects.toThrow(ForbiddenError);

    // InfraMole signs its requests with the connection's own key.
    const provider = await adminDb().ssoProvider.findFirstOrThrow();
    const config = JSON.parse(provider.samlConfig!) as Record<string, unknown>;
    expect(config.authnRequestsSigned).toBe(true);
    expect(String(config.privateKey)).toContain("PRIVATE KEY");

    const audit = await adminDb().auditEvent.findFirst({
      where: { action: "sso.connection_created" },
    });
    expect(audit?.workspaceId).toBe(owner.workspaceId);
  });

  it("keep the SP key when the IdP metadata is replaced, and delete cleanly", async () => {
    const owner = await ownerContext("Uni");
    const { id } = await createSsoConnection(owner, saml("uni.example"));
    const before = JSON.parse((await adminDb().ssoProvider.findFirstOrThrow()).samlConfig!);
    await updateSsoConnection(owner, id, saml("uni.example", { name: "Renamed" }));
    const after = JSON.parse((await adminDb().ssoProvider.findFirstOrThrow()).samlConfig!);
    expect(after.spCertificate).toBe(before.spCertificate);
    await expect(
      updateSsoConnection(owner, id, saml("other.example", { name: "Moved" })),
    ).rejects.toThrow(SsoError);

    await deleteSsoConnection(owner, id);
    expect(await adminDb().workspaceSso.count()).toBe(0);
    expect(await adminDb().ssoProvider.count()).toBe(0);
  });

  it("refuse public mail domains, empty rules, and a domain another workspace holds", async () => {
    const a = await ownerContext("A");
    const b = await ownerContext("B");
    await expect(createSsoConnection(a, saml("gmail.com"))).rejects.toThrow();
    await expect(
      createSsoConnection(a, saml("uni.example", { groupRules: "", defaultRole: "" })),
    ).rejects.toThrow(/at least one group/);
    await expect(
      createSsoConnection(a, saml("uni.example", { groupRules: "admins = owner" })),
    ).rejects.toThrow(SsoError);
    await createSsoConnection(a, saml("uni.example"));
    await expect(createSsoConnection(b, saml("uni.example"))).rejects.toThrow(/already connected/);
  });

  it("are isolated per workspace", async () => {
    const a = await ownerContext("A");
    const b = await ownerContext("B");
    const { id } = await createSsoConnection(a, saml("uni.example"));
    expect(await listSsoConnections(b)).toEqual([]);
    await expect(updateSsoConnection(b, id, saml("uni.example"))).rejects.toThrow(/not found/);
    await expect(deleteSsoConnection(b, id)).rejects.toThrow(/not found/);
  });

  it("LDAP: only ldaps:// to public addresses, unless the operator trusts the server", async () => {
    const owner = await ownerContext("Uni");
    const ldap = (url: string) => ({
      protocol: "LDAP",
      name: "Directory",
      domain: "uni.example",
      url,
      bindDn: "cn=svc,dc=uni,dc=example",
      bindPassword: "secret-password",
      baseDn: "dc=uni,dc=example",
      groupRules: "it-admins = admin",
    });
    await expect(createSsoConnection(owner, ldap("ldap://10.0.0.5:389"))).rejects.toThrow(
      /ldaps:\/\//,
    );
    await expect(createSsoConnection(owner, ldap("ldaps://127.0.0.1:636"))).rejects.toThrow(
      /not a public address/,
    );
    expect(await adminDb().workspaceSso.count()).toBe(0);
  });
});

describe("domain proof", () => {
  it("needs the DNS TXT record before anyone can sign in", async () => {
    const owner = await ownerContext("Proof");
    const { id, providerId } = await createSsoConnection(owner, saml("proof.example"));
    expect(await ssoForEmail("alice@proof.example")).toBeNull();
    const decision = await decideSsoSignIn({
      providerId,
      email: "alice@proof.example",
      claims: { groups: ["it-admins"] },
    });
    expect(decision).toMatchObject({ action: "reject", code: "sso_disabled" });

    await expect(verifySsoDomain(owner, id, async () => [["wrong"]])).rejects.toThrow(SsoError);
    const asked: string[] = [];
    await verifySsoDomain(owner, id, async (name) => {
      asked.push(name);
      return [[domainProof(providerId)]];
    });
    expect(asked).toEqual(["_inframole-sso.proof.example"]);
    expect(await ssoForEmail("alice@proof.example")).toMatchObject({ providerId });
    expect(await adminDb().ssoProvider.findFirst({ select: { domainVerified: true } })).toEqual({
      domainVerified: true,
    });
  });
});

describe("sign-in decisions", () => {
  it("map groups to roles, follow directory changes, never touch owners", async () => {
    const owner = await ownerContext("Uni");
    const { providerId } = await createSsoConnection(owner, saml("uni.example"));
    const decide = (email: string, groups: string[]) =>
      decideSsoSignIn({ providerId, email, claims: { groups } });
    const roleOf = async (userId: string) =>
      (
        await adminDb().membership.findUnique({
          where: { workspaceId_userId: { workspaceId: owner.workspaceId, userId } },
        })
      )?.role ?? null;

    // A new person: the account is created by the plugin, then provisioned.
    expect(await decide("alice@uni.example", ["CN=it-admins,OU=Groups"])).toEqual({
      action: "continue",
    });
    const alice = await userWithEmail("alice@uni.example");
    await provisionSsoUser(providerId, alice);
    expect(await roleOf(alice.id)).toBe("ADMIN");

    // Moved to another group: the role follows at the next sign-in.
    expect(await decide("alice@uni.example", ["service-desk"])).toEqual({
      action: "link",
      userId: alice.id,
    });
    await provisionSsoUser(providerId, alice);
    expect(await roleOf(alice.id)).toBe("VIEWER");

    // Out of every mapped group: refused, and out of the workspace.
    expect(await decide("alice@uni.example", ["students"])).toMatchObject({
      action: "reject",
      code: "sso_no_access",
    });
    expect(await roleOf(alice.id)).toBeNull();

    // The provider may only vouch for its own domain.
    expect(await decide("mallory@evil.example", ["it-admins"])).toMatchObject({
      action: "reject",
      code: "sso_wrong_domain",
    });

    // Owners are never demoted or removed by a directory.
    const ownerUser = await adminDb().user.update({
      where: { id: owner.userId },
      data: { email: "boss@uni.example" },
    });
    await decide("boss@uni.example", ["service-desk"]);
    await provisionSsoUser(providerId, ownerUser);
    await decide("boss@uni.example", []);
    expect(await roleOf(owner.userId)).toBe("OWNER");

    const actions = await adminDb().auditEvent.findMany({
      where: { workspaceId: owner.workspaceId, action: { startsWith: "member." } },
      select: { action: true, actorLabel: true },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "member.joined",
      "member.role_changed",
      "member.removed",
    ]);
    expect(actions[0]!.actorLabel).toBe("Single sign-on (University login)");
  });

  it("a default role lets in people of no listed group; a disabled connection lets in nobody", async () => {
    const owner = await ownerContext("Uni");
    const { id, providerId } = await createSsoConnection(
      owner,
      saml("uni.example", { groupRules: "", defaultRole: "VIEWER" }),
    );
    expect(
      await decideSsoSignIn({ providerId, email: "bob@uni.example", claims: {} }),
    ).toMatchObject({ action: "continue" });
    const { setSsoEnabled } = await import("@/server/modules/sso/sso");
    await setSsoEnabled(owner, id, false);
    expect(
      await decideSsoSignIn({ providerId, email: "bob@uni.example", claims: {} }),
    ).toMatchObject({ action: "reject", code: "sso_disabled" });
    expect(await ssoForEmail("bob@uni.example")).toBeNull();
  });
});

describe("SSO only", () => {
  it("refuses password sign-in, sign-up and reset for the domain, not for others", async () => {
    const owner = await ownerContext("Uni");
    await createSsoConnection(owner, saml("uni.example", { enforced: true }));
    expect(await ssoEnforcedFor("alice@uni.example")).toBeTruthy();
    expect(await ssoEnforcedFor("alice@other.example")).toBeNull();

    const base = process.env.BETTER_AUTH_URL!.replace(/\/$/, "");
    const post = (path: string, body: object) =>
      getAuth().handler(
        new Request(`${base}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify(body),
        }),
      );
    for (const [path, body] of [
      ["/sign-in/email", { email: "alice@uni.example", password: "whatever-password" }],
      ["/sign-up/email", { email: "new@uni.example", password: "whatever-password", name: "New" }],
      ["/request-password-reset", { email: "alice@uni.example", redirectTo: "/" }],
    ] as const) {
      const res = await post(path, body);
      expect(res.status, path).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe(SSO_ONLY_MESSAGE);
    }
    const other = await post("/sign-in/email", {
      email: "alice@other.example",
      password: "whatever-password",
    });
    expect(other.status).toBe(401);
  });

  it("the plugin's own provider management is switched off", async () => {
    const base = process.env.BETTER_AUTH_URL!.replace(/\/$/, "");
    const res = await getAuth().handler(
      new Request(`${base}/api/auth/sso/register`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ providerId: "x", issuer: "https://x", domain: "x.example" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
