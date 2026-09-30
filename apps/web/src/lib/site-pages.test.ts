// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { docPages } from "./docs-nav";
import { PRIVATE_PATHS, publicPaths, sitemapEntries } from "./site-pages";

describe("public pages (M18)", () => {
  it("lists the site, every doc page and the listed legal pages — never the app", () => {
    const paths = publicPaths({ demo: false });
    expect(paths.slice(0, 3)).toEqual(["/", "/agent", "/docs"]);
    expect(paths).toContain("/legal/privacy");
    expect(paths).not.toContain("/legal/terms"); // unlisted until Cloud opens
    expect(paths.filter((p) => p.startsWith("/docs/"))).toHaveLength(docPages("en").length);
    expect(paths).not.toContain("/demo");
    expect(publicPaths({ demo: true })).toContain("/demo");
    for (const p of paths) for (const priv of PRIVATE_PATHS) expect(p.startsWith(priv)).toBe(false);
  });

  it("gives each page an English and a Spanish entry with alternates", () => {
    const entries = sitemapEntries("https://inframole.com/", { demo: true });
    expect(entries.length).toBe(publicPaths({ demo: true }).length * 2);
    expect(entries[0]).toEqual({
      url: "https://inframole.com",
      changeFrequency: "weekly",
      priority: 1,
      alternates: {
        languages: {
          en: "https://inframole.com",
          es: "https://inframole.com/es",
          "x-default": "https://inframole.com",
        },
      },
    });
    const install = entries.find((e) => e.url.endsWith("/es/docs/installation/linux"));
    expect(install?.alternates.languages.en).toBe("https://inframole.com/docs/installation/linux");
  });
});
