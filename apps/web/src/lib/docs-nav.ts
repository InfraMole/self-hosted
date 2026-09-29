// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Documentation portal (/docs) — navigation manifest. Order here is the order
 * of the sidebar and of "Previous / Next". Each page is
 * apps/web/content/docs/<slug>.md, rendered at build time (lib/docs-render.ts).
 */
export interface DocPage {
  slug: string;
  title: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const DOCS_NAV: DocSection[] = [
  {
    title: "Getting started",
    pages: [
      { slug: "getting-started", title: "What is InfraMole" },
      { slug: "quickstart", title: "Quickstart" },
    ],
  },
  {
    title: "Installation guide",
    pages: [
      { slug: "installation/requirements", title: "Requirements" },
      { slug: "installation/linux", title: "Install on Linux" },
      { slug: "installation/windows", title: "Install on Windows" },
      { slug: "installation/macos", title: "Install on macOS" },
      { slug: "installation/configuration", title: "Configuration" },
    ],
  },
  {
    title: "Agent",
    pages: [
      { slug: "agent/overview", title: "How the agent works" },
      { slug: "agent/install", title: "Install the agent" },
      { slug: "agent/proxmox", title: "Proxmox inventory" },
      { slug: "agent/manage", title: "Manage and remove" },
    ],
  },
  {
    title: "User manual",
    pages: [
      { slug: "manual/library", title: "Library" },
      { slug: "manual/relationships", title: "Relationships and suggestions" },
      { slug: "manual/map-and-impact", title: "Map and impact" },
      { slug: "manual/changes", title: "Changes" },
      { slug: "manual/imports", title: "Import files" },
      { slug: "manual/integrations", title: "Cloud integrations" },
      { slug: "manual/members-and-security", title: "Members and security" },
    ],
  },
  {
    title: "Operations",
    pages: [
      { slug: "operations/backups", title: "Backup and restore" },
      { slug: "operations/upgrade", title: "Upgrade guide" },
      { slug: "operations/troubleshooting", title: "Troubleshooting" },
    ],
  },
  {
    title: "Reference",
    pages: [
      { slug: "reference/environment", title: "Environment variables" },
      { slug: "reference/editions", title: "Editions and limits" },
      { slug: "reference/relationship-types", title: "Relationship types" },
    ],
  },
];

export const DOC_PAGES: (DocPage & { section: string })[] = DOCS_NAV.flatMap((s) =>
  s.pages.map((p) => ({ ...p, section: s.title })),
);

export function findDoc(slug: string) {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  if (i < 0) return null;
  return { page: DOC_PAGES[i]!, prev: DOC_PAGES[i - 1] ?? null, next: DOC_PAGES[i + 1] ?? null };
}
