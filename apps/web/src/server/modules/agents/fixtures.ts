// SPDX-License-Identifier: AGPL-3.0-only
/** Test fixture: a valid v1 report (used by unit and integration tests). */
import type { ReportV1 } from "./protocol";

export function sampleReport(overrides: Partial<ReportV1> = {}): ReportV1 {
  return {
    schemaVersion: 1,
    agentVersion: "0.1.0",
    collectedAt: "2026-09-28T10:05:00Z",
    windowStart: "2026-09-28T10:00:00Z",
    host: {
      hostname: "APP01",
      fqdn: "app01.corp.local",
      os: "windows",
      osName: "Microsoft Windows Server 2022 Standard",
      osVersion: "10.0.20348",
      arch: "amd64",
    },
    interfaces: [
      { name: "Ethernet0", mac: "00:15:5d:01:02:03", addresses: ["10.0.0.23/24", "fe80::1/64"] },
      { name: "Loopback", addresses: ["127.0.0.1/8", "::1/128"] },
    ],
    services: [
      {
        name: "W3SVC",
        displayName: "World Wide Web Publishing Service",
        state: "running",
        startType: "auto",
      },
    ],
    listeners: [{ proto: "tcp", address: "0.0.0.0", port: 443, process: { name: "System" } }],
    connections: [
      {
        proto: "tcp",
        direction: "outbound",
        localPort: 0,
        remoteAddress: "10.0.0.40",
        remotePort: 1433,
        process: { name: "w3wp.exe" },
        count: 10,
        firstSeen: "2026-09-28T10:00:00Z",
        lastSeen: "2026-09-28T10:04:30Z",
      },
    ],
    ...overrides,
  };
}
