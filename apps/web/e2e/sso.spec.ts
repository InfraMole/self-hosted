// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enterprise single sign-on (M33): an owner connects a SAML provider for a
 * domain the operator trusts (SSO_TRUSTED_DOMAINS, env.ts); people of that
 * domain are sent to it with a signed request, and "SSO only" turns their
 * password sign-in off. The identity provider is a fake: the request is
 * caught before it leaves the browser.
 */
import { expect, test } from "@playwright/test";
import { OWNER, SSO_DOMAIN } from "./env";

const w = `/w/${OWNER.slug}`;
const IDP = `https://idp.${SSO_DOMAIN}/saml`;
const METADATA = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.${SSO_DOMAIN}">
  <IDPSSODescriptor WantAuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${IDP}"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;

test("an owner connects SAML single sign-on; its people are sent to their provider", async ({
  page,
  browser,
}) => {
  await page.goto(`${w}/settings#sso`);
  const card = page.locator("#sso");
  const row = card.getByRole("listitem").filter({ hasText: "E2E University" });
  // A retry starts clean.
  if (await row.count()) {
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Delete single sign-on E2E University" }).click();
    await expect(row).toBeHidden();
  }
  await card.getByRole("button", { name: "Add single sign-on" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Protocol").selectOption("SAML");
  await sheet.getByLabel("Name").fill("E2E University");
  await sheet.getByLabel("Email domain").fill(SSO_DOMAIN);
  await sheet.getByLabel("Identity provider metadata (XML)").fill(METADATA);
  await sheet.getByLabel("Group rules (one per line)").fill("it-admins = admin");
  await sheet.getByLabel(/SSO only/).check();
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet).toBeHidden();

  await expect(row.getByText("verified")).toBeVisible();
  await expect(row.getByText("SSO only")).toBeVisible();
  await row.getByText("Settings for your identity provider").click();
  await expect(row.getByText("Reply URL (ACS)")).toBeVisible();
  await expect(row.locator("pre").filter({ hasText: "BEGIN CERTIFICATE" })).toBeVisible();

  // Signed out: the domain's people cannot use a password…
  const visitor = await (await browser.newContext({ storageState: undefined })).newPage();
  await visitor.goto("/sign-in");
  await visitor.getByLabel("Email").fill(`alice@${SSO_DOMAIN}`);
  await visitor.getByLabel("Password").fill("any-password-123");
  await visitor.locator('button[type="submit"]').click();
  await expect(visitor.locator("p[role=alert]")).toContainText("signs in with single sign-on");

  // …and "Sign in with SSO" sends them to their provider with a signed request.
  const request = new Promise<URL>((resolve) =>
    visitor.route(`${IDP}**`, async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Fake IdP</p>" });
    }),
  );
  await visitor.getByLabel("Work email").fill(`alice@${SSO_DOMAIN}`);
  await visitor.getByRole("button", { name: "Continue with single sign-on" }).click();
  const sent = await request;
  expect(sent.searchParams.get("SAMLRequest")).toBeTruthy();
  expect(sent.searchParams.get("Signature")).toBeTruthy();
  await expect(visitor.getByText("Fake IdP")).toBeVisible();

  // A domain without single sign-on gets a plain answer.
  await visitor.goto("/sign-in");
  await visitor.getByRole("button", { name: "Sign in with SSO" }).click();
  await visitor.getByLabel("Work email").fill("bob@elsewhere.example");
  await visitor.getByRole("button", { name: "Continue with single sign-on" }).click();
  await expect(visitor.locator("p[role=alert]")).toHaveText(
    "Single sign-on is not set up for this email domain.",
  );
  await visitor.context().close();

  // Removing it gives the domain its passwords back.
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Delete single sign-on E2E University" }).click();
  await expect(row).toBeHidden();
});
