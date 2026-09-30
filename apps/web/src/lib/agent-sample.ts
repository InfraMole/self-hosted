// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A realistic agent report for the public "What the agent collects" page
 * (M12). agent-sample.test.ts validates it against the real protocol schema,
 * so the page can never show fields the agent does not (or cannot) send.
 */
export const SAMPLE_REPORT = {
  schemaVersion: 1,
  agentVersion: "0.3.0",
  collectedAt: "2026-09-29T10:05:00Z",
  windowStart: "2026-09-29T10:00:00Z",
  host: {
    hostname: "prod-web-01",
    fqdn: "prod-web-01.corp.local",
    os: "windows",
    osName: "Microsoft Windows Server 2022 Standard",
    osVersion: "10.0.20348",
    kernelVersion: "10.0.20348",
    arch: "amd64",
    bootTime: "2026-09-01T06:30:00Z",
  },
  interfaces: [{ name: "Ethernet0", mac: "00:15:5d:01:02:03", addresses: ["10.20.4.15/24"] }],
  services: [
    {
      name: "W3SVC",
      displayName: "World Wide Web Publishing Service",
      state: "running",
      startType: "auto",
    },
  ],
  listeners: [{ proto: "tcp", address: "0.0.0.0", port: 443, process: { name: "System", pid: 4 } }],
  connections: [
    {
      proto: "tcp",
      direction: "outbound",
      localPort: 0,
      remoteAddress: "10.20.4.40",
      remotePort: 1433,
      process: { name: "w3wp.exe", path: "C:\\Windows\\System32\\inetsrv\\w3wp.exe" },
      count: 42,
      firstSeen: "2026-09-29T10:00:00Z",
      lastSeen: "2026-09-29T10:04:30Z",
    },
    {
      proto: "tcp",
      direction: "inbound",
      localPort: 443,
      remoteAddress: "10.20.1.5",
      remotePort: 0,
      count: 318,
      firstSeen: "2026-09-29T10:00:02Z",
      lastSeen: "2026-09-29T10:04:58Z",
    },
  ],
  truncated: false,
  workloads: {
    collectedAt: "2026-09-29T10:05:00Z",
    iisSites: [
      {
        name: "Portal",
        bindings: [{ protocol: "https", port: 443, host: "portal.corp.local" }],
      },
    ],
    sqlDatabases: [{ instance: "MSSQLSERVER", name: "Customers" }],
  },
} as const;
