#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Business licences (M9, ADR-019). Run on a trusted machine, never on a server.
 *
 *   node scripts/licence.mjs keygen --out <dir>
 *       Creates <dir>/depmap-licence-private.pem (0600) and prints the public
 *       key to paste into src/server/modules/billing/licence-keys.ts.
 *       Keep the private key offline (password manager / HSM).
 *
 *   node scripts/licence.mjs issue --key <private.pem> --licensee "ACME SL" --days 365
 * Business licences are not sized by servers/VMs (ADR-024); `nodes` is gone.
 *       Prints a licence string (dml1.…) for DEPMAP_LICENSE_KEY.
 */
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const [command, ...rest] = process.argv.slice(2);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (command === "keygen") {
  const { values } = parseArgs({ args: rest, options: { out: { type: "string" } } });
  if (!values.out) fail("keygen: --out <dir> is required");
  const file = path.join(values.out, "depmap-licence-private.pem");
  if (existsSync(file)) fail(`refusing to overwrite ${file}`);
  mkdirSync(values.out, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows: restrict the file with its ACL instead */
  }
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  console.log(`Private key: ${file}  (keep it offline; anyone with it can issue licences)`);
  console.log(`Public key (add to LICENCE_PUBLIC_KEYS in licence-keys.ts):\n${spki}`);
} else if (command === "issue") {
  const { values } = parseArgs({
    args: rest,
    options: {
      key: { type: "string" },
      licensee: { type: "string" },
      days: { type: "string", default: "365" },
    },
  });
  if (!values.key || !values.licensee) fail("issue: --key and --licensee are required");
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 3660) fail("--days must be 1–3660");
  const now = new Date();
  const payload = {
    id: randomUUID(),
    licensee: values.licensee,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  };
  const body = `dml1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const key = createPrivateKey(readFileSync(values.key));
  const signature = sign(null, Buffer.from(body), key).toString("base64url");
  console.error(
    `Licence ${payload.id} for ${payload.licensee} until ${payload.expiresAt.slice(0, 10)}`,
  );
  console.log(`${body}.${signature}`);
} else {
  fail("usage: licence.mjs keygen --out <dir> | issue --key <pem> --licensee <name> [--days 365]");
}
