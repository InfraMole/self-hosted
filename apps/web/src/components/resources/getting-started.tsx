// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { ArrowRight, Cloud, FileUp, Server, type LucideIcon } from "lucide-react";
import { hasRole, type Role } from "@/server/authz";

/**
 * First run (M12): an empty workspace shows the three ways to fill it and
 * what happens next — Install → Discover → Understand. Options the user's
 * role cannot perform say who can.
 */
export function GettingStarted({
  slug,
  role,
  addButton,
}: {
  slug: string;
  role: Role;
  addButton: React.ReactNode;
}) {
  const admin = hasRole(role, "ADMIN");
  const member = hasRole(role, "MEMBER");
  const options: {
    icon: LucideIcon;
    title: string;
    body: string;
    href: string | null;
    cta: string;
    note?: string;
  }[] = [
    {
      icon: Server,
      title: "Install the agent",
      body: "One read-only binary per server, Windows or Linux. It reports hosts, services and the connections between them every few minutes.",
      href: admin ? `/w/${slug}/settings#agents` : null,
      cta: "Create an enrollment token",
      note: "Workspace admins create enrollment tokens.",
    },
    {
      icon: Cloud,
      title: "Connect a cloud",
      body: "Azure, AWS or Cloudflare with a read-only token, encrypted at rest and synced on a schedule.",
      href: admin ? `/w/${slug}/settings#integrations` : null,
      cta: "Add an integration",
      note: "Workspace admins connect integrations.",
    },
    {
      icon: FileUp,
      title: "Import a file",
      body: "A CSV, a docker-compose file, or an export from Proxmox, Azure, AWS or Cloudflare. You review everything before it is saved.",
      href: member ? `/w/${slug}/library/import` : null,
      cta: "Import",
      note: "Members and above can import.",
    },
  ];
  return (
    <section className="border-border-strong rounded-lg border border-dashed p-6 sm:p-8">
      <p className="text-accent font-mono text-xs">getting started</p>
      <h2 className="mt-2 text-lg font-semibold tracking-tight">Map your first servers</h2>
      <p className="text-muted mt-1 max-w-2xl text-sm">
        Pick any way to start — you can combine them later. Discovered things appear as suggestions;
        nothing is presented as a confirmed dependency until someone confirms it.
      </p>
      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {options.map(({ icon: Icon, ...o }) => (
          <li
            key={o.title}
            className="border-border bg-surface flex flex-col rounded-md border p-4"
          >
            <Icon className="text-accent size-5" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold">{o.title}</h3>
            <p className="text-muted mt-1 flex-1 text-xs leading-relaxed">{o.body}</p>
            {o.href ? (
              <Link
                href={o.href}
                className="text-accent mt-4 inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                {o.cta} <ArrowRight className="size-3" />
              </Link>
            ) : (
              <p className="text-subtle mt-4 text-xs">{o.note}</p>
            )}
          </li>
        ))}
      </ol>
      <div className="text-muted mt-6 flex flex-wrap items-center justify-between gap-3 text-xs">
        <p>
          Then: review{" "}
          <Link href={`/w/${slug}/suggestions`} className="text-foreground hover:underline">
            Suggestions
          </Link>
          , open the{" "}
          <Link href={`/w/${slug}/map`} className="text-foreground hover:underline">
            Map
          </Link>
          , and ask what could be affected before a change.{" "}
          <Link href="/agent" className="text-foreground hover:underline">
            What does the agent collect?
          </Link>
        </p>
        {addButton && <div className="flex items-center gap-2">Or add one by hand {addButton}</div>}
      </div>
    </section>
  );
}
