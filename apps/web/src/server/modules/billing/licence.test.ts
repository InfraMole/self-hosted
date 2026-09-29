// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { verifyLicence } from "./licence";

const script = path.resolve(import.meta.dirname, "../../../../scripts/licence.mjs");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Uses the real issuing script: keygen, then issue. */
function keypair() {
  const dir = mkdtempSync(path.join(tmpdir(), "depmap-lic-"));
  dirs.push(dir);
  const out = execFileSync(process.execPath, [script, "keygen", "--out", dir], {
    encoding: "utf8",
  });
  const publicKey = out.trim().split("\n").at(-1)!;
  const issue = (licensee: string, days = 365) =>
    execFileSync(
      process.execPath,
      [
        script,
        "issue",
        "--key",
        path.join(dir, "depmap-licence-private.pem"),
        "--licensee",
        licensee,
        "--days",
        String(days),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  return { publicKey, issue };
}

describe("business licence", () => {
  const ours = keypair();
  const theirs = keypair();

  it("accepts a licence signed with a trusted key", () => {
    const state = verifyLicence(ours.issue("ACME SL"), [ours.publicKey]);
    expect(state).toMatchObject({ valid: true, payload: { licensee: "ACME SL" } });
    expect(state.payload?.nodes).toBeUndefined(); // ADR-024: not sized by nodes
  });

  it("rejects tampering, foreign keys, expiry, garbage and builds without keys", () => {
    const licence = ours.issue("ACME SL");
    const [prefix, payload, sig] = licence.split(".");
    const forged = JSON.parse(Buffer.from(payload!, "base64url").toString());
    forged.licensee = "Someone Else";
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    expect(verifyLicence(tampered, [ours.publicKey])).toMatchObject({
      valid: false,
      reason: /signature/,
    });
    expect(verifyLicence(theirs.issue("ACME SL"), [ours.publicKey])).toMatchObject({
      valid: false,
      reason: /signature/,
    });

    const later = new Date(Date.now() + 2 * 86_400_000);
    expect(verifyLicence(ours.issue("ACME SL", 1), [ours.publicKey], later)).toMatchObject({
      valid: false,
      reason: /expired/,
    });

    expect(verifyLicence("not-a-licence", [ours.publicKey])).toMatchObject({
      valid: false,
      reason: /malformed/,
    });
    expect(verifyLicence(undefined, [ours.publicKey])).toMatchObject({ valid: false });
    expect(verifyLicence(licence, [])).toMatchObject({ valid: false, reason: /verification key/ });
    // Rotation: any trusted key works.
    expect(verifyLicence(licence, [theirs.publicKey, ours.publicKey]).valid).toBe(true);
  });
});
