// SPDX-License-Identifier: AGPL-3.0-only
import { X509Certificate, createPrivateKey, createSign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSpCertificate } from "./sp-certificate";

describe("SAML service provider certificate", () => {
  it("is a valid self-signed certificate whose key signs what it verifies", () => {
    const { certPem, keyPem } = createSpCertificate("InfraMole SSO sso-test");
    const cert = new X509Certificate(certPem);
    expect(cert.subject).toBe("CN=InfraMole SSO sso-test");
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(new Date(cert.validTo).getFullYear()).toBeGreaterThanOrEqual(
      new Date().getFullYear() + 9,
    );
    const signature = createSign("sha256").update("authn request").sign(createPrivateKey(keyPem));
    expect(cert.publicKey.asymmetricKeyType).toBe("rsa");
    expect(verify("sha256", Buffer.from("authn request"), cert.publicKey, signature)).toBe(true);
  });
});
