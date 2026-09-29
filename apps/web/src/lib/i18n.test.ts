// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { languageAlternates, localeOf, localePath, unlocalizedPath } from "./i18n";

describe("i18n paths", () => {
  it("prefixes Spanish paths and keeps English at the root", () => {
    expect(localePath("en", "/docs/quickstart")).toBe("/docs/quickstart");
    expect(localePath("es", "/")).toBe("/es");
    expect(localePath("es", "/#pricing")).toBe("/es#pricing");
    expect(localePath("es", "/docs/agent/install")).toBe("/es/docs/agent/install");
  });

  it("detects the language and strips the prefix", () => {
    expect(localeOf("/es")).toBe("es");
    expect(localeOf("/es/docs")).toBe("es");
    expect(localeOf("/essentials")).toBe("en");
    expect(localeOf("/docs")).toBe("en");
    expect(unlocalizedPath("/es")).toBe("/");
    expect(unlocalizedPath("/es/legal/privacy")).toBe("/legal/privacy");
    expect(unlocalizedPath("/docs")).toBe("/docs");
  });

  it("builds absolute hreflang alternates", () => {
    expect(languageAlternates("/docs").languages).toEqual({
      en: "https://inframole.com/docs",
      es: "https://inframole.com/es/docs",
      "x-default": "https://inframole.com/docs",
    });
    expect(languageAlternates("/").languages.es).toBe("https://inframole.com/es");
  });
});
