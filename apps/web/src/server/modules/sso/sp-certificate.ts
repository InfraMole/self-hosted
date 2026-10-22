// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { AsnConvert } from "@peculiar/asn1-schema";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  Certificate,
  Name,
  RelativeDistinguishedName,
  SubjectPublicKeyInfo,
  TBSCertificate,
  Validity,
  Version,
} from "@peculiar/asn1-x509";

/** sha256WithRSAEncryption. */
const SHA256_RSA = "1.2.840.113549.1.1.11";
const COMMON_NAME = "2.5.4.3";

/**
 * A certificate serial from random bytes: positive, and with a non-zero first
 * byte so the DER INTEGER is minimally encoded (a redundant leading zero is
 * "illegal padding" — it failed about one certificate in 500).
 */
export function certificateSerial(random: Uint8Array): Uint8Array {
  const serial = new Uint8Array(random);
  serial[0] = (serial[0]! % 0x7f) + 1; // 0x01…0x7f
  return serial;
}

/**
 * A self-signed certificate and key for one SAML connection's service
 * provider (M33): InfraMole signs its authentication requests with it and
 * publishes the certificate in its SP metadata, as many identity providers
 * (ADFS, Shibboleth, Keycloak by default) require. RSA-2048, 10 years.
 */
export function createSpCertificate(commonName: string): { certPem: string; keyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const name = new Name([
    new RelativeDistinguishedName([
      new AttributeTypeAndValue({
        type: COMMON_NAME,
        value: new AttributeValue({ utf8String: commonName }),
      }),
    ]),
  ]);
  const algorithm = new AlgorithmIdentifier({ algorithm: SHA256_RSA, parameters: null });
  const serial = certificateSerial(randomBytes(16));
  const now = new Date();
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: new Uint8Array(serial).buffer,
    signature: algorithm,
    issuer: name,
    validity: new Validity({
      notBefore: new Date(now.getTime() - 60_000),
      notAfter: new Date(now.getTime() + 10 * 365 * 86_400_000),
    }),
    subject: name,
    subjectPublicKeyInfo: AsnConvert.parse(
      publicKey.export({ type: "spki", format: "der" }),
      SubjectPublicKeyInfo,
    ),
  });
  const tbsDer = Buffer.from(AsnConvert.serialize(tbs));
  const signature = sign("sha256", tbsDer, privateKey);
  const cert = new Certificate({
    tbsCertificate: tbs,
    signatureAlgorithm: algorithm,
    signatureValue: new Uint8Array(signature).buffer,
  });
  const der = Buffer.from(AsnConvert.serialize(cert));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END CERTIFICATE-----\n`;
  // Parses and self-verifies, or throws: never store a broken certificate.
  const parsed = new X509Certificate(certPem);
  if (!parsed.verify(parsed.publicKey)) throw new Error("SP certificate self-check failed");
  return {
    certPem,
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}
