// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { QuickSearch, type QuickSearchHit } from "./quick-search";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Boxes,
  ClipboardList,
  ChevronsUpDown,
  CircleArrowUp,
  History,
  Inbox,
  LogOut,
  Menu,
  Moon,
  Network,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/logo";
import { FeedbackDialog, type FeedbackAction } from "./feedback-dialog";
import { authClient } from "@/lib/auth-client";
import { setTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface SidebarProps {
  workspace: {
    name: string;
    slug: string;
  };
  workspaces: { name: string; slug: string }[];
  user: { name: string; email: string };
  /** Detected relationships awaiting review. */
  suggestionCount: number;
  /** Null when FEEDBACK_EMAIL / SMTP are not configured. */
  feedbackAction: FeedbackAction | null;
  /** Quick search (M29). */
  search: (q: string) => Promise<QuickSearchHit[]>;
  /** A newer InfraMole release, shown to admins (M36). */
  newerVersion?: string | null;
}

const PRIMARY_NAV = [
  { segment: "library", label: "Library", icon: Boxes },
  { segment: "map", label: "Map", icon: Network },
  { segment: "plan", label: "Plan a change", icon: ClipboardList },
  { segment: "suggestions", label: "Suggestions", icon: Inbox },
  { segment: "changes", label: "Changes", icon: History },
] as const;

export function Sidebar({
  workspace,
  workspaces,
  user,
  suggestionCount,
  feedbackAction,
  search,
  newerVersion,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();
  const base = `/w/${workspace.slug}`;
  // Phones (M41): the sidebar is a drawer behind a menu button.
  const [open, setOpen] = useState(false);
  const section =
    PRIMARY_NAV.find(({ segment }) => pathname.startsWith(`${base}/${segment}`))?.label ??
    (pathname.startsWith(`${base}/settings`) ? "Settings" : null);

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <>
      <div className="border-border bg-surface flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="text-muted hover:bg-surface-2 hover:text-foreground rounded-md p-1.5"
        >
          <Menu className="size-5" />
        </button>
        <LogoMark className="shrink-0" />
        <span className="min-w-0 truncate text-sm font-medium">{workspace.name}</span>
        {section && <span className="text-subtle shrink-0 text-sm">· {section}</span>}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "border-border bg-surface flex w-56 shrink-0 flex-col border-r",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-64 max-md:transition-transform",
          !open && "max-md:-translate-x-full",
        )}
        // Following a link closes the drawer; Escape too.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="text-subtle hover:bg-surface-2 hover:text-foreground absolute top-3.5 -right-10 rounded-md p-1.5 md:hidden"
          hidden={!open}
        >
          <X className="size-5" />
        </button>
        <details className="group border-border relative border-b">
          <summary className="hover:bg-surface-2 flex h-14 cursor-pointer list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
            <LogoMark className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.name}</span>
            <ChevronsUpDown className="text-subtle size-3.5 shrink-0" />
          </summary>
          <div className="border-border-strong bg-surface-2 absolute inset-x-2 top-full z-20 mt-1 rounded-md border p-1 shadow-lg shadow-black/30">
            <p className="text-subtle px-2 pt-1 pb-1.5 text-[11px]">Workspaces</p>
            {workspaces.map((w) => (
              <Link
                key={w.slug}
                href={`/w/${w.slug}/library`}
                className={cn(
                  "hover:bg-surface block truncate rounded px-2 py-1.5 text-sm",
                  w.slug === workspace.slug ? "text-foreground" : "text-muted",
                )}
              >
                {w.name}
              </Link>
            ))}
            <div className="border-border my-1 border-t" />
            <Link
              href="/onboarding"
              className="text-muted hover:bg-surface hover:text-foreground flex items-center gap-2 rounded px-2 py-1.5 text-sm"
            >
              <Plus className="size-3.5" /> New workspace
            </Link>
          </div>
        </details>

        <QuickSearch slug={workspace.slug} search={search} />

        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Primary">
          {PRIMARY_NAV.map(({ segment, label, icon: Icon }) => (
            <NavLink
              key={segment}
              href={`${base}/${segment}`}
              active={pathname.startsWith(`${base}/${segment}`)}
            >
              <Icon />
              {label}
              {segment === "suggestions" && suggestionCount > 0 && (
                <span
                  className="border-accent/40 text-accent ml-auto rounded border px-1.5 font-mono text-[10px] leading-4"
                  aria-label={`${suggestionCount} to review`}
                >
                  {suggestionCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-border flex flex-col gap-0.5 border-t p-2">
          {newerVersion && (
            <Link
              href={`${base}/settings#version`}
              className="text-warning hover:bg-surface-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
            >
              <CircleArrowUp className="size-3.5 shrink-0" />
              <span>
                InfraMole <span className="font-mono">{newerVersion}</span> is available
              </span>
            </Link>
          )}
          <NavLink href={`${base}/settings`} active={pathname.startsWith(`${base}/settings`)}>
            <Settings />
            Settings
          </NavLink>
          {feedbackAction && <FeedbackDialog action={feedbackAction} />}
          <div className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5">
            <Link
              href="/account"
              title="Account & security"
              className="hover:text-foreground min-w-0 flex-1 rounded"
            >
              <p className="text-foreground truncate text-xs">{user.name}</p>
              <p className="text-subtle truncate font-mono text-[11px]">{user.email}</p>
            </Link>
            <Link
              href="/account"
              title="Account & security"
              aria-label="Account & security"
              className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
            >
              <ShieldCheck className="size-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              aria-label={
                theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"
              }
              className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors [&_svg]:size-4",
        active
          ? "bg-surface-2 text-foreground [&_svg]:text-accent"
          : "text-muted hover:bg-surface-2/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
