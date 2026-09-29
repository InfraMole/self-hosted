// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/landing/landing";
import { SAMPLE_REPORT } from "@/lib/agent-sample";

export const metadata: Metadata = {
  title: "What the agent collects",
  description:
    "Exactly what the read-only InfraMole agent reports, why, and what it never collects.",
};

// Public, identical for every edition: honesty about data collection (docs/AGENT.md §3).
export const dynamic = "force-static";

const collected = [
  {
    data: "Hostname, FQDN, OS name and version, kernel, architecture, boot time",
    why: "Identify the machine and show what it is.",
  },
  {
    data: "Machine ID (only when enrolling)",
    why: "Recognise the same machine after a reinstall of the agent, instead of creating a duplicate.",
  },
  {
    data: "Network interfaces: name, MAC, IP addresses (loopback skipped)",
    why: "Match connections from other hosts to this one.",
  },
  {
    data: "Running services: name, display name, state, start type",
    why: "Show what runs on the host (IIS, SQL Server, nginx…).",
  },
  {
    data: "Listening TCP ports and the owning process name / path",
    why: "Know what the host offers to others.",
  },
  {
    data: "Established TCP connections, aggregated per peer, port and process — counts and first/last seen",
    why: "Suggest who depends on whom. Shown as “detected”, never as confirmed.",
  },
];

const never = [
  "Passwords, credentials or tokens",
  "File contents or user documents",
  "Process command lines or arguments",
  "Environment variables",
  "Browser data",
  "Logged-in users",
  "Packet contents — only which peer and port, never the data",
];

export default function AgentPage() {
  return (
    <div className="light flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-14 sm:px-6">
        <p className="text-accent font-mono text-xs tracking-wide">transparency</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          What the agent collects
        </h1>
        <p className="text-muted mt-4 max-w-2xl text-base leading-relaxed">
          <span className="font-mono text-[0.95em]">inframole-agent</span> is a single, signed,
          read-only binary for Windows and Linux. Every five minutes it sends one small report over
          HTTPS. It has <strong className="text-foreground">no command channel</strong>: the server
          can only answer with its reporting settings, never tell it to run anything.
        </p>
        <div className="border-border bg-surface mt-6 rounded-lg border p-4 text-sm">
          See for yourself before installing anything — this prints the exact report and sends
          nothing:
          <pre className="bg-surface-2 mt-3 overflow-x-auto rounded-md px-3 py-2 font-mono text-[13px]">
            inframole-agent dry-run
          </pre>
        </div>

        <h2 className="mt-14 text-xl font-semibold">Collected, and why</h2>
        <div className="border-border mt-4 overflow-hidden rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-muted text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-4 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {collected.map((c) => (
                <tr key={c.data} className="align-top">
                  <td className="px-4 py-3">{c.data}</td>
                  <td className="text-muted px-4 py-3">{c.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-14 text-xl font-semibold">Never collected</h2>
        <ul className="text-muted mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {never.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="bg-danger mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
        <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
          Enforced twice: the agent&apos;s data structures have no fields for any of this, and the
          server rejects any report with a field it does not expect.
        </p>

        <h2 className="mt-14 text-xl font-semibold">A real report</h2>
        <p className="text-muted mt-2 text-sm">
          Shortened to one item per list. This sample is checked against the live protocol schema
          in our test suite.
        </p>
        <pre className="border-border bg-surface mt-4 max-h-[520px] overflow-auto rounded-lg border p-4 font-mono text-[12.5px] leading-relaxed">
          {JSON.stringify(SAMPLE_REPORT, null, 2)}
        </pre>

        <h2 className="mt-14 text-xl font-semibold">Good to know</h2>
        <ul className="text-muted mt-4 space-y-3 text-sm leading-relaxed">
          <li>
            <strong className="text-foreground">Aggregated, not recorded.</strong> Connections are
            sampled every 30 seconds and summarised per peer, port and process. Loopback,
            link-local and multicast traffic is ignored. Raw reports are kept for 7 days.
          </li>
          <li>
            <strong className="text-foreground">Permissions.</strong> It runs as a service
            (LocalSystem or root) so it can see which process owns a port. Without admin rights it
            still works, with fewer process names.
          </li>
          <li>
            <strong className="text-foreground">Optional Proxmox inventory.</strong> Only if you
            enable it on the host, with a read-only token that never leaves the machine: node, VM
            and container names, ids, status and memory size. Nothing else from the API is kept.
          </li>
          <li>
            <strong className="text-foreground">Verifiable.</strong> Releases are signed and
            published with SHA-256 checksums; the install commands verify them before running.
          </li>
          <li>
            <strong className="text-foreground">Easy to remove.</strong>{" "}
            <span className="font-mono text-[0.95em]">inframole-agent uninstall</span> stops the
            service and deletes its configuration. Revoking the agent in InfraMole rejects its
            reports immediately.
          </li>
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
