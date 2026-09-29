// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SecretConfigError,
  SecretDecryptError,
  buildKeyring,
  needsRotation,
  openSecret,
  sealSecret,
  secretHint,
} from "./crypto";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");

describe("secret sealing", () => {
  const keyring = buildKeyring({ key: k1, version: 1 });

  it("round-trips and never stores plaintext", () => {
    const sealed = sealSecret("cf-token-abcdef123456", "ws1:int1", keyring);
    expect(sealed.keyVersion).toBe(1);
    expect(Buffer.from(sealed.ciphertext, "base64").toString("utf8")).not.toContain("cf-token");
    expect(openSecret(sealed, "ws1:int1", keyring)).toBe("cf-token-abcdef123456");
  });

  it("uses a fresh IV every time", () => {
    const a = sealSecret("same", "x", keyring);
    const b = sealSecret("same", "x", keyring);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("is bound to its owner (AAD): another workspace/row cannot decrypt it", () => {
    const sealed = sealSecret("secret", "ws1:int1", keyring);
    expect(() => openSecret(sealed, "ws2:int1", keyring)).toThrow(SecretDecryptError);
    expect(() => openSecret(sealed, "ws1:int2", keyring)).toThrow(SecretDecryptError);
  });

  it("detects tampering and wrong keys", () => {
    const sealed = sealSecret("secret", "a", keyring);
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() =>
      openSecret({ ...sealed, ciphertext: bytes.toString("base64") }, "a", keyring),
    ).toThrow(SecretDecryptError);
    expect(() => openSecret(sealed, "a", buildKeyring({ key: k2, version: 1 }))).toThrow(
      SecretDecryptError,
    );
  });

  it("supports key rotation: old secrets still open, new ones use the new key", () => {
    const old = sealSecret("secret", "a", keyring);
    const rotated = buildKeyring({ key: k2, previousKey: k1, version: 2 });
    expect(openSecret(old, "a", rotated)).toBe("secret");
    expect(needsRotation(old, rotated)).toBe(true);
    const fresh = sealSecret("secret", "a", rotated);
    expect(fresh.keyVersion).toBe(2);
    expect(() => openSecret(fresh, "a", keyring)).toThrow(SecretDecryptError);
  });

  it("requires a valid key", () => {
    expect(() => buildKeyring({ version: 1 })).toThrow(SecretConfigError);
    expect(() => buildKeyring({ key: "c2hvcnQ=", version: 1 })).toThrow(/32 bytes/);
  });

  it("hints only the last characters", () => {
    expect(secretHint("abcdefgh1234")).toBe("1234");
    expect(secretHint("short")).toBe("");
  });
});
