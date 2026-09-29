// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enrollment tokens and agent secrets (docs/SECURITY.md §6, ADR-010).
 * 32 random bytes, base64url, typed prefix; only sha256 is stored.
 */
import { createHash, randomBytes } from "node:crypto";

export type SecretKind = "enrollment" | "agent" | "invitation";

const PREFIX: Record<SecretKind, string> = {
  enrollment: "dmp_enr_",
  agent: "dmp_agt_",
  invitation: "dmp_inv_",
};

/** 32 bytes -> 43 base64url chars. */
const BODY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedSecret {
  /** Shown once to the user / agent. Never stored. */
  value: string;
  hash: string;
  /** Non-secret display prefix, e.g. "dmp_enr_Ab3x". */
  displayPrefix: string;
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateSecret(kind: SecretKind): GeneratedSecret {
  const value = PREFIX[kind] + randomBytes(32).toString("base64url");
  return { value, hash: hashSecret(value), displayPrefix: value.slice(0, PREFIX[kind].length + 4) };
}

/** Cheap shape check before any DB lookup. */
export function isWellFormed(value: string, kind: SecretKind): boolean {
  const prefix = PREFIX[kind];
  return value.startsWith(prefix) && BODY_PATTERN.test(value.slice(prefix.length));
}

/** Extracts an agent secret from an `Authorization: Bearer …` header. */
export function bearerAgentSecret(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token && isWellFormed(token, "agent") ? token : null;
}
