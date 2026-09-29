// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Public keys that verify Business licences (M9, ADR-019), as base64 DER
 * (SPKI) Ed25519 keys. Generate the pair with
 *   node apps/web/scripts/licence.mjs keygen --out <private dir>
 * keep the PRIVATE key offline (password manager / HSM), and paste the printed
 * public key here. Several keys allow rotation. Empty = no licence can be
 * valid in this build (the business edition then behaves like Community).
 */
export const LICENCE_PUBLIC_KEYS: readonly string[] = [];
