// SPDX-License-Identifier: AGPL-3.0-only
import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// The Content-Security-Policy is set at runtime by src/proxy.ts (ADR-047): it
// depends on the installation (analytics origin), not on the build.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo root, so standalone output traces workspace dependencies.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@depmap/graph"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
