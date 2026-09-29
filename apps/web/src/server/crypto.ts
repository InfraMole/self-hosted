// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Secret sealing for stored integration credentials (ADR-018 D, SECURITY T16).
 *
 * AES-256-GCM, random 96-bit IV per secret, authentication tag appended to
 * the ciphertext, and Additional Authenticated Data binding the ciphertext to
 * its owner (e.g. `workspaceId:integrationId`): a ciphertext copied to
 * another row or tenant fails to decrypt. Keys live outside the database
 * (env) and carry a version for rotation.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SealedSecret {
  /** base64(ciphertext || 16-byte GCM tag) */
  ciphertext: string;
  /** base64(12-byte IV) */
  iv: string;
  keyVersion: number;
}

export interface Keyring {
  current: { version: number; key: Buffer };
  byVersion: Map<number, Buffer>;
}

export class SecretConfigError extends Error {
  constructor(message = "Credential encryption is not configured (CREDENTIALS_ENCRYPTION_KEY).") {
    super(message);
    this.name = "SecretConfigError";
  }
}

export class SecretDecryptError extends Error {
  constructor() {
    super("Stored credential could not be decrypted (wrong key, tampered data or wrong owner).");
    this.name = "SecretDecryptError";
  }
}

const TAG_BYTES = 16;

export function buildKeyring(input: {
  key?: string;
  previousKey?: string;
  version: number;
}): Keyring {
  if (!input.key) throw new SecretConfigError();
  const decode = (k: string) => {
    const buf = Buffer.from(k, "base64");
    if (buf.length !== 32)
      throw new SecretConfigError("Encryption keys must be 32 bytes (base64).");
    return buf;
  };
  const current = { version: input.version, key: decode(input.key) };
  const byVersion = new Map([[current.version, current.key]]);
  if (input.previousKey && input.version > 1)
    byVersion.set(input.version - 1, decode(input.previousKey));
  return { current, byVersion };
}

export function sealSecret(plaintext: string, aad: string, keyring: Keyring): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.current.key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    ciphertext: body.toString("base64"),
    iv: iv.toString("base64"),
    keyVersion: keyring.current.version,
  };
}

export function openSecret(sealed: SealedSecret, aad: string, keyring: Keyring): string {
  const key = keyring.byVersion.get(sealed.keyVersion);
  if (!key) throw new SecretDecryptError();
  try {
    const body = Buffer.from(sealed.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptError();
  }
}

/** True when a sealed secret should be re-encrypted with the current key. */
export function needsRotation(sealed: Pick<SealedSecret, "keyVersion">, keyring: Keyring): boolean {
  return sealed.keyVersion !== keyring.current.version;
}

/** Last characters of a secret, safe to display ("•••• abcd"). */
export function secretHint(plaintext: string): string {
  return plaintext.length >= 8 ? plaintext.slice(-4) : "";
}
