// SPDX-License-Identifier: AGPL-3.0-only
import { Marked, type Tokens } from "marked";

/** Tabs per :::tabs group that globals.css can show (nth-of-type rules). */
const MAX_TABS = 12;

/**
 * Markdown → HTML for the documentation portal (build time only; the input is
 * repository content, never user input). Adds, on top of GFM:
 *
 *   :::steps            numbered steps — every `### heading` inside is a step
 *   :::tabs             OS tabs — `@tab Linux` lines start each tab (CSS-only,
 *                       synced by label on the client)
 *   :::note|tip|warning [title]   callouts
 *   :::                 closes the innermost block
 *
 * Headings get stable ids; `## / ###` are returned for "On this page".
 */
export interface DocHeading {
  depth: 2 | 3;
  text: string;
  id: string;
}

export interface RenderedDoc {
  html: string;
  title: string;
  headings: DocHeading[];
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Block =
  | { kind: "md"; text: string }
  | { kind: "container"; name: string; arg: string; children: Block[] };

/** Splits the source into markdown runs and (nested) ::: containers. Fences are respected. */
export function parseBlocks(source: string): Block[] {
  const root: Block[] = [];
  const stack: { children: Block[] }[] = [{ children: root }];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buffer.length) stack.at(-1)!.children.push({ kind: "md", text: buffer.join("\n") });
    buffer = [];
  };
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (line.trim().startsWith(fence)) fence = null;
      buffer.push(line);
      continue;
    }
    if (fence === null) {
      const open = /^:::(steps|tabs|note|tip|warning)\s*(.*)$/.exec(line.trim());
      if (open) {
        flush();
        const block: Block = { kind: "container", name: open[1]!, arg: open[2]!, children: [] };
        stack.at(-1)!.children.push(block);
        stack.push(block);
        continue;
      }
      if (line.trim() === ":::" && stack.length > 1) {
        flush();
        stack.pop();
        continue;
      }
    }
    buffer.push(line);
  }
  flush();
  if (stack.length > 1) throw new Error("docs: unclosed ::: block");
  return root;
}

const CALLOUT_TITLE: Record<string, string> = { note: "Note", tip: "Tip", warning: "Warning" };

/** `calloutTitles`: default titles of untitled callouts, per language (M14). */
export function renderDoc(
  source: string,
  calloutTitles: Record<string, string> = CALLOUT_TITLE,
): RenderedDoc {
  const headings: DocHeading[] = [];
  const used = new Map<string, number>();
  let title = "";
  let tabGroup = 0;

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token) {
        const { depth } = token as Tokens.Heading;
        const inner = this.parser.parseInline((token as Tokens.Heading).tokens);
        const plain = (token as Tokens.Heading).text.replace(/`/g, "");
        if (depth === 1) {
          title ||= plain;
          return `<h1>${inner}</h1>\n`;
        }
        const base = slugify(plain);
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth === 2 || depth === 3) headings.push({ depth, text: plain, id });
        return `<h${depth} id="${id}"><a class="doc-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token) {
        const { href, tokens } = token as Tokens.Link;
        const inner = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inner}</a>`;
      },
    },
  });

  const md = (text: string) => marked.parse(text, { async: false }) as string;

  const render = (blocks: Block[]): string =>
    blocks
      .map((b) => {
        if (b.kind === "md") return md(b.text);
        if (b.name === "steps") return `<div class="doc-steps">\n${render(b.children)}</div>\n`;
        if (b.name === "tabs") {
          const group = `tabs-${tabGroup++}`;
          const tabs: { label: string; body: string[] }[] = [];
          const text = b.children.map((c) => (c.kind === "md" ? c.text : "\u0000")).join("\n");
          if (text.includes("\u0000")) throw new Error("docs: no nested blocks inside :::tabs");
          for (const line of text.split("\n")) {
            const tab = /^@tab\s+(.+)$/.exec(line.trim());
            if (tab) tabs.push({ label: tab[1]!.trim(), body: [] });
            else if (tabs.length) tabs.at(-1)!.body.push(line);
          }
          if (tabs.length === 0) throw new Error("docs: :::tabs needs @tab lines");
          // globals.css shows panels by position; keep MAX_TABS in step with it.
          if (tabs.length > MAX_TABS) throw new Error(`docs: at most ${MAX_TABS} tabs per :::tabs`);
          const inputs = tabs
            .map(
              (t, i) =>
                `<input type="radio" name="${group}" id="${group}-${i}" data-tab="${escapeHtml(t.label)}"${i === 0 ? " checked" : ""}><label for="${group}-${i}">${escapeHtml(t.label)}</label>`,
            )
            .join("");
          const panels = tabs
            .map((t) => `<div class="doc-tab-panel">\n${md(t.body.join("\n"))}</div>`)
            .join("\n");
          return `<div class="doc-tabs">${inputs}\n${panels}</div>\n`;
        }
        const heading = escapeHtml(b.arg || calloutTitles[b.name] || CALLOUT_TITLE[b.name]!);
        return `<div class="doc-callout doc-callout-${b.name}"><p class="doc-callout-title">${heading}</p>\n${render(b.children)}</div>\n`;
      })
      .join("");

  const html = render(parseBlocks(source));
  return { html, title, headings };
}

/** Plain text for the search index: markdown syntax and containers stripped. */
export function plainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^:::.*$/gm, " ")
    .replace(/^@tab .*$/gm, " ")
    .replace(/[#>*_`|[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
