// SPDX-License-Identifier: AGPL-3.0-only
import { SITE_URL } from "./i18n";

/**
 * Release notes (M36): the server's CHANGELOG.md and the agent's
 * agent/CHANGELOG.md, parsed at build time into one timeline for /changelog
 * and its Atom feed. Only `## x.y.z — YYYY-MM-DD` sections count; "Unreleased"
 * and the preamble are left out.
 */
export type ReleaseProduct = "server" | "agent";

export interface Release {
  product: ReleaseProduct;
  version: string;
  /** YYYY-MM-DD */
  date: string;
  /** The section's markdown, without its heading. */
  body: string;
}

export const CHANGELOG_PATH = "/changelog";
export const CHANGELOG_FEED_PATH = "/changelog/feed.xml";
export const CHANGELOG_URL = `${SITE_URL}${CHANGELOG_PATH}`;

const HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\s*$/;

export function parseChangelog(source: string, product: ReleaseProduct): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  let lines: string[] = [];
  const close = () => {
    if (current) releases.push({ ...current, body: lines.join("\n").trim() });
    current = null;
    lines = [];
  };
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("## ")) {
      close();
      const m = HEADING.exec(line);
      if (m) current = { product, version: m[1]!, date: m[2]!, body: "" };
    } else if (current) lines.push(line);
  }
  close();
  return releases;
}

/** Anchor of a release on /changelog: `v0.26.0`, `agent-v0.6.1`. */
export function releaseAnchor(product: ReleaseProduct, version: string): string {
  return `${product === "agent" ? "agent-" : ""}v${version}`;
}

/** Link to a release's notes on inframole.com (an installation only has its own). */
export function releaseNotesUrl(product: ReleaseProduct, version: string): string {
  return `${CHANGELOG_URL}#${releaseAnchor(product, version)}`;
}

export function releaseTitle(r: Pick<Release, "product" | "version">): string {
  return r.product === "agent" ? `Agent ${r.version}` : `InfraMole ${r.version}`;
}

/** Compare "a.b.c" versions: positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Newest first; on the same day the server before the agent. */
export function mergeReleases(...lists: Release[][]): Release[] {
  return lists
    .flat()
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (a.product === b.product
          ? compareVersions(b.version, a.version)
          : a.product === "server"
            ? -1
            : 1),
    );
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Atom 1.0 feed of the newest releases. `html` renders a release body; the
 * output is escaped into `<content type="html">`.
 */
export function releasesFeed(
  releases: Release[],
  options: { siteUrl: string; html: (body: string) => string; limit?: number },
): string {
  const site = options.siteUrl.replace(/\/+$/, "");
  const page = `${site}${CHANGELOG_PATH}`;
  const shown = releases.slice(0, options.limit ?? 30);
  const updated = shown[0] ? `${shown[0].date}T00:00:00Z` : "1970-01-01T00:00:00Z";
  const entries = shown.map((r) => {
    const link = `${page}#${releaseAnchor(r.product, r.version)}`;
    return [
      "  <entry>",
      `    <title>${xml(releaseTitle(r))}</title>`,
      `    <id>${xml(link)}</id>`,
      `    <link rel="alternate" type="text/html" href="${xml(link)}"/>`,
      `    <updated>${r.date}T00:00:00Z</updated>`,
      `    <content type="html">${xml(options.html(r.body))}</content>`,
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>InfraMole release notes</title>",
    "  <subtitle>New versions of the InfraMole server and agent.</subtitle>",
    `  <id>${xml(page)}</id>`,
    `  <link rel="alternate" type="text/html" href="${xml(page)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(`${site}${CHANGELOG_FEED_PATH}`)}"/>`,
    `  <updated>${updated}</updated>`,
    "  <author><name>InfraMole</name></author>",
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}
