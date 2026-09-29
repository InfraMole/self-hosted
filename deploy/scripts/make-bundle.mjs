#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Builds the self-hosted bundle (docs: apps/web/content/self-hosted.md):
//   node deploy/scripts/make-bundle.mjs <version> <out-dir>
// → <out-dir>/inframole-self-hosted/ with docker-compose.yml (published images
// pinned to <version>, no build sections), Caddyfile, .env.example, scripts
// and the install guide as README.md. The release workflow tars it.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [version, outDir = "dist"] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: make-bundle.mjs <semver> [out-dir]");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.resolve(outDir, "inframole-self-hosted");
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "scripts"), { recursive: true });

/** Drops every `build:` block (a key line plus its deeper-indented lines). */
export function stripBuild(yaml) {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)build:\s*$/.exec(lines[i]);
    if (!m) {
      kept.push(lines[i]);
      continue;
    }
    const indent = m[1].length;
    while (
      i + 1 < lines.length &&
      /^\s*/.exec(lines[i + 1])[0].length > indent &&
      lines[i + 1].trim()
    )
      i++;
  }
  return kept.join("\n");
}

let compose = stripBuild(readFileSync(path.join(root, "deploy/docker-compose.prod.yml"), "utf8"));
compose = compose
  .replaceAll("${INFRAMOLE_VERSION:-latest}", `\${INFRAMOLE_VERSION:-${version}}`)
  .replace(/^name: .*$/m, "name: inframole")
  .replace(
    /^# Production stack[\s\S]*?(?=^#\n# Only Caddy)/m,
    `# InfraMole ${version} — self-hosted stack. Install guide: README.md.\n#   cp .env.example .env && ./scripts/gen-secrets.sh .env && $EDITOR .env\n#   docker compose up -d\n`,
  );
if (/^\s*build:/m.test(compose)) throw new Error("build section left in the bundle compose file");
writeFileSync(path.join(out, "docker-compose.yml"), compose);

cpSync(path.join(root, "deploy/Caddyfile"), path.join(out, "Caddyfile"));
cpSync(path.join(root, "deploy/.env.production.example"), path.join(out, ".env.example"));
for (const f of ["gen-secrets.sh", "gen-secrets.ps1", "restore.sh", "db-shell.sh"]) {
  cpSync(path.join(root, "deploy/scripts", f), path.join(out, "scripts", f));
  chmodSync(path.join(out, "scripts", f), 0o755);
}
const guide = readFileSync(path.join(root, "apps/web/content/self-hosted.md"), "utf8");
writeFileSync(
  path.join(out, "README.md"),
  `${guide.trimEnd()}

---

Bundle version: ${version}
`,
);
writeFileSync(path.join(out, "VERSION"), `${version}\n`);
console.log(`bundle: ${out}`);
