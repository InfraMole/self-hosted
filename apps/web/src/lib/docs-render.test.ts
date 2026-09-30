// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseBlocks, plainText, renderDoc, slugify } from "./docs-render";

describe("docs renderer", () => {
  it("gives headings unique ids and collects the table of contents", () => {
    const doc = renderDoc(
      "# Install on Linux\n\n## Install Docker\n\n### Ubuntu\n\n## Install Docker\n",
    );
    expect(doc.title).toBe("Install on Linux");
    expect(doc.headings).toEqual([
      { depth: 2, text: "Install Docker", id: "install-docker" },
      { depth: 3, text: "Ubuntu", id: "ubuntu" },
      { depth: 2, text: "Install Docker", id: "install-docker-1" },
    ]);
    expect(doc.html).toContain('<h2 id="install-docker">');
  });

  it("renders steps, callouts and tabs (with nested steps)", () => {
    const src = [
      ":::steps",
      "### Download",
      ":::tabs",
      "@tab Linux",
      "```sh",
      "curl -O x",
      "```",
      "@tab Windows",
      "```powershell",
      "Invoke-WebRequest x",
      "```",
      ":::",
      "### Start",
      ":::warning Keep a copy",
      "Back up `.env`.",
      ":::",
      ":::",
    ].join("\n");
    const { html, headings } = renderDoc(src);
    expect(html).toContain('<div class="doc-steps">');
    expect(html).toMatch(
      /<input type="radio" name="tabs-0" id="tabs-0-0" data-tab="Linux" checked>/,
    );
    expect(html).toContain('data-tab="Windows"');
    expect(html.match(/doc-tab-panel/g)).toHaveLength(2);
    expect(html).toContain("Invoke-WebRequest x");
    expect(html).toContain('<p class="doc-callout-title">Keep a copy</p>');
    expect(headings.map((h) => h.id)).toEqual(["download", "start"]);
  });

  it("does not treat ::: inside code fences as blocks", () => {
    const blocks = parseBlocks("```\n:::tabs\n```\ntext");
    expect(blocks).toHaveLength(1);
  });

  it("rejects unclosed blocks and marks external links", () => {
    expect(() => renderDoc(":::note\nopen")).toThrow(/unclosed/);
    expect(renderDoc("[x](https://a.test)").html).toContain(
      'target="_blank" rel="noopener noreferrer"',
    );
    expect(renderDoc("[x](/docs/quickstart)").html).not.toContain("_blank");
  });

  it("renders up to 12 tabs and refuses more (globals.css shows panels by position)", () => {
    const tabs = (n: number) =>
      `:::tabs\n${Array.from({ length: n }, (_, i) => `@tab T${i}\nbody ${i}`).join("\n")}\n:::`;
    expect(renderDoc(tabs(12)).html.match(/doc-tab-panel/g)).toHaveLength(12);
    expect(() => renderDoc(tabs(13))).toThrow(/at most 12 tabs/);
  });

  it("slugifies and strips markup for search", () => {
    expect(slugify("Back up `.env` — now!")).toBe("back-up-env-now");
    expect(plainText("## Title\n```sh\nsecret\n```\n:::note\nHello *there*\n:::")).toBe(
      "Title Hello there",
    );
  });
});
