// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cost measurement, step 2 (ADR-055): simulated agents send realistic reports
 * (~70 services, ~10 listeners, ~50 destinations — the size measured for a
 * real agent) through the real HTTP API, each on its own 5-minute cycle.
 * Usage: node scripts/load/agents.mjs <agents.json> <baseUrl> <intervalSec> <durationSec> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [file, baseUrl, intervalArg, durationArg, out] = process.argv.slice(2);
const interval = Number(intervalArg) * 1000;
const duration = Number(durationArg) * 1000;
const { customers } = JSON.parse(readFileSync(file, "utf8"));

const SERVICES = Array.from({ length: 70 }, (_, i) => ({
  name: `Service${i}`,
  displayName: `Example service number ${i}`,
  state: i % 5 === 0 ? "stopped" : "running",
  startType: "auto",
}));
const PUBLIC = Array.from({ length: 12 }, (_, i) => `203.0.113.${i + 10}`);

/** Role by position: the first servers are domain controllers and databases. */
function role(i, size) {
  if (i < Math.max(2, Math.round(size * 0.04))) return "dc";
  if (i < Math.max(4, Math.round(size * 0.2))) return "db";
  return "app";
}

function report(customer, i, cycle) {
  const agent = customer.agents[i];
  const size = customer.agents.length;
  const r = role(i, size);
  const now = new Date();
  const start = new Date(now.getTime() - 300_000);
  const peers = customer.agents.filter((_, j) => role(j, size) !== "app");
  const dcs = customer.agents.filter((_, j) => role(j, size) === "dc");
  const dbs = customer.agents.filter((_, j) => role(j, size) === "db");
  const conn = (remoteAddress, remotePort, name, direction = "outbound", localPort = 0) => ({
    proto: "tcp",
    direction,
    localPort,
    remoteAddress,
    remotePort,
    process: { name },
    count: 5 + ((i + cycle + remotePort) % 50),
    firstSeen: start.toISOString(),
    lastSeen: now.toISOString(),
  });
  const connections = [];
  for (const dc of dcs.slice(0, 2))
    for (const port of [53, 88, 389, 445]) connections.push(conn(dc.ip, port, "lsass.exe"));
  if (r === "app") {
    for (const db of [dbs[i % dbs.length], dbs[(i + 1) % dbs.length]])
      connections.push(conn(db.ip, 1433, "w3wp.exe"));
    for (const p of PUBLIC) connections.push(conn(p, 443, "w3wp.exe"));
  }
  // Inbound clients until about 50 destinations (varies a little per cycle).
  const target = 46 + ((i + cycle) % 8);
  for (let k = 0; connections.length < target; k++) {
    const peer = customer.agents[(i + 7 * k + 1) % size];
    const port = r === "db" ? 1433 : r === "dc" ? 389 : 443;
    connections.push(conn(peer === agent ? peers[0].ip : peer.ip, 0, "System", "inbound", port));
  }
  const listeners = [53, 88, 135, 389, 443, 445, 1433, 3389, 5985, 8080].map((port) => ({
    proto: "tcp",
    address: "0.0.0.0",
    port,
    process: { name: port === 1433 ? "sqlservr.exe" : "System" },
  }));
  return {
    schemaVersion: 1,
    agentVersion: "0.6.1",
    collectedAt: now.toISOString(),
    windowStart: start.toISOString(),
    host: {
      hostname: agent.hostname,
      fqdn: `${agent.hostname.toLowerCase()}.corp.example`,
      os: i % 3 === 0 ? "linux" : "windows",
      osName: i % 3 === 0 ? "Ubuntu 24.04 LTS" : "Microsoft Windows Server 2022 Standard",
      osVersion: "10.0.20348",
      arch: "amd64",
    },
    interfaces: [
      { name: "Ethernet0", mac: "00:15:5d:01:02:03", addresses: [`${agent.ip}/16`, "fe80::1/64"] },
      { name: "Loopback", addresses: ["127.0.0.1/8", "::1/128"] },
    ],
    services: SERVICES,
    listeners,
    connections,
  };
}

const samples = [];
let errors = 0;
let bytes = 0;
const started = Date.now();

async function send(customer, i, cycle) {
  const body = JSON.stringify(report(customer, i, cycle));
  bytes += body.length;
  const t = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/agent/v1/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${customer.agents[i].secret}`,
      },
      body,
    });
    await res.text();
    if (!res.ok) {
      errors++;
      if (errors < 5) console.error("status", res.status);
    }
  } catch (error) {
    errors++;
    if (errors < 5) console.error(String(error));
  }
  samples.push({ at: Date.now() - started, ms: performance.now() - t, size: customer.size });
}

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

const timers = [];
for (const customer of customers)
  customer.agents.forEach((_, i) => {
    let cycle = 0;
    // Agents start at random moments within the first interval, like real ones.
    const offset = Math.random() * interval;
    timers.push(
      setTimeout(() => {
        void send(customer, i, cycle++);
        timers.push(setInterval(() => void send(customer, i, cycle++), interval));
      }, offset),
    );
  });

const progress = setInterval(() => {
  const last = samples.filter((s) => s.at > Date.now() - started - 60_000).map((s) => s.ms);
  console.log(
    `${Math.round((Date.now() - started) / 1000)}s reports=${samples.length} last-min=${last.length} p50=${pct(last, 50)}ms p95=${pct(last, 95)}ms errors=${errors}`,
  );
}, 60_000);

setTimeout(() => {
  timers.forEach((t) => clearTimeout(t) ?? clearInterval(t));
  clearInterval(progress);
  setTimeout(() => {
    const ms = samples.map((s) => s.ms);
    const summary = {
      reports: samples.length,
      errors,
      avgReportBytes: Math.round(bytes / Math.max(1, samples.length)),
      p50: pct(ms, 50),
      p95: pct(ms, 95),
      p99: pct(ms, 99),
      max: Math.round(Math.max(0, ...ms)),
    };
    console.log(JSON.stringify(summary));
    writeFileSync(out, JSON.stringify({ summary, samples }));
    process.exit(0);
  }, 5_000);
}, duration);
