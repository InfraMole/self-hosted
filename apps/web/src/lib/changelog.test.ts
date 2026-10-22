// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  mergeReleases,
  parseChangelog,
  releaseNotesUrl,
  releasesFeed,
} from "./changelog";

const SERVER = `# Changelog

What changed.

## Unreleased

### Added

- Not out yet.

## 0.26.0 — 2026-10-22

### Fixed

- A fix.

## 0.25.0 — 2026-10-22

### Added

- **Plan a change** <for you> & more.
`;

const AGENT = `# Changelog

## 0.6.1 — 2026-10-02

- Templates.
`;

describe("release notes", () => {
  it("keeps only released versions, with their sections", () => {
    const releases = parseChangelog(SERVER.replace(/\n/g, "\r\n"), "server");
    expect(releases.map((r) => r.version)).toEqual(["0.26.0", "0.25.0"]);
    expect(releases[0]).toEqual({
      product: "server",
      version: "0.26.0",
      date: "2026-10-22",
      body: "### Fixed\n\n- A fix.",
    });
    expect(releases.some((r) => r.body.includes("Not out yet"))).toBe(false);
  });

  it("merges server and agent newest first", () => {
    const merged = mergeReleases(parseChangelog(AGENT, "agent"), parseChangelog(SERVER, "server"));
    expect(merged.map((r) => `${r.product} ${r.version}`)).toEqual([
      "server 0.26.0",
      "server 0.25.0",
      "agent 0.6.1",
    ]);
  });

  it("links to a release on inframole.com", () => {
    expect(releaseNotesUrl("server", "0.26.0")).toBe("https://inframole.com/changelog#v0.26.0");
    expect(releaseNotesUrl("agent", "0.6.1")).toBe("https://inframole.com/changelog#agent-v0.6.1");
  });

  it("builds an Atom feed with escaped content", () => {
    const feed = releasesFeed(
      mergeReleases(parseChangelog(SERVER, "server"), parseChangelog(AGENT, "agent")),
      { siteUrl: "https://inframole.com/", html: (body) => `<p>${body}</p>`, limit: 2 },
    );
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(feed).toContain("<updated>2026-10-22T00:00:00Z</updated>");
    expect(feed).toContain("<title>InfraMole 0.25.0</title>");
    expect(feed).toContain("<id>https://inframole.com/changelog#v0.25.0</id>");
    expect(feed).toContain("&lt;for you&gt; &amp; more");
    expect(feed).not.toContain("Agent 0.6.1"); // limit
    expect(feed).toContain('href="https://inframole.com/changelog/feed.xml"');
  });

  it("compares versions numerically", () => {
    expect(compareVersions("0.18.10", "0.18.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.18.2", "0.18.2")).toBe(0);
  });
});
