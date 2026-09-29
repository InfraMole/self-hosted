// SPDX-License-Identifier: AGPL-3.0-only
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/server/env";
import { LICENCE_PUBLIC_KEYS } from "./licence-keys";

/**
 * Business licence (M9, ADR-019): verified offline — no phone-home.
 * Format: `dml1.<base64url(JSON payload)>.<base64url(Ed25519 signature)>`,
 * the signature covering `dml1.<payload>`. Issued with scripts/licence.mjs.
 */
export const LICENCE_PREFIX = "dml1";

export const licencePayloadSchema = z.object({
  id: z.string().min(4).max(64),
  licensee: z.string().min(1).max(200),
  /** Legacy (ADR-019 per-node licences). Ignored since ADR-024: Business is not sized by nodes. */
  nodes: z.number().int().min(1).max(1_000_000).optional(),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type LicencePayload = z.infer<typeof licencePayloadSchema>;

export type LicenceState =
  | { valid: true; payload: LicencePayload }
  | { valid: false; reason: string; payload?: LicencePayload };

export function verifyLicence(
  licence: string | undefined,
  publicKeys: readonly string[] = LICENCE_PUBLIC_KEYS,
  now = new Date(),
): LicenceState {
  if (!licence) return { valid: false, reason: "No licence key configured (DEPMAP_LICENSE_KEY)." };
  if (publicKeys.length === 0)
    return { valid: false, reason: "This build has no licence verification key." };
  const parts = licence.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENCE_PREFIX)
    return { valid: false, reason: "The licence key is malformed." };
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2]!, "base64url");
  const trusted = publicKeys.some((k) => {
    try {
      const key = createPublicKey({ key: Buffer.from(k, "base64"), format: "der", type: "spki" });
      return verify(null, signed, key, signature);
    } catch {
      return false;
    }
  });
  if (!trusted) return { valid: false, reason: "The licence signature is not valid." };
  let payload: LicencePayload;
  try {
    payload = licencePayloadSchema.parse(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
    );
  } catch {
    return { valid: false, reason: "The licence content is invalid." };
  }
  if (new Date(payload.expiresAt) <= now)
    return {
      valid: false,
      reason: `The licence expired on ${payload.expiresAt.slice(0, 10)}.`,
      payload,
    };
  return { valid: true, payload };
}

/** The licence configured in DEPMAP_LICENSE_KEY, checked against this build's keys. */
export function currentLicence(now = new Date()): LicenceState {
  return verifyLicence(getEnv().DEPMAP_LICENSE_KEY, LICENCE_PUBLIC_KEYS, now);
}
