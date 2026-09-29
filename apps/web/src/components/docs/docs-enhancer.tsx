// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect } from "react";

const OS_KEY = "inframole.docs.tab";

/**
 * Progressive enhancement for rendered docs (works without it):
 * - a "Copy" button on every code block;
 * - OS tabs stay in sync across the page (pick Windows once) and the choice
 *   is remembered in this browser.
 */
export function DocsEnhancer({ pageKey }: { pageKey: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".doc-prose");
    if (!root) return;

    const buttons: HTMLButtonElement[] = [];
    for (const pre of root.querySelectorAll("pre")) {
      if (pre.querySelector(".doc-copy")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "doc-copy";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy to clipboard");
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            pre.querySelector("code")?.innerText ?? pre.innerText,
          );
          button.textContent = "Copied";
        } catch {
          button.textContent = "Select & copy";
        }
        setTimeout(() => (button.textContent = "Copy"), 1500);
      });
      pre.appendChild(button);
      buttons.push(button);
    }

    const inputs = [...root.querySelectorAll<HTMLInputElement>(".doc-tabs input[data-tab]")];
    const select = (label: string) => {
      for (const i of inputs) if (i.dataset.tab === label) i.checked = true;
    };
    try {
      const saved = localStorage.getItem(OS_KEY);
      if (saved) select(saved);
    } catch {
      /* storage unavailable: defaults stay */
    }
    const onChange = (e: Event) => {
      const label = (e.target as HTMLInputElement).dataset.tab;
      if (!label) return;
      select(label);
      try {
        localStorage.setItem(OS_KEY, label);
      } catch {
        /* ignore */
      }
    };
    for (const i of inputs) i.addEventListener("change", onChange);
    return () => {
      for (const i of inputs) i.removeEventListener("change", onChange);
      for (const b of buttons) b.remove();
    };
  }, [pageKey]);
  return null;
}
