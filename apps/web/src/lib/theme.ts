// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Light / dark app theme (ADR-054). Dark stays the default; the choice is
 * kept per browser and applied before the first paint by THEME_SCRIPT in the
 * root layout, so the page never flashes the other theme. "system" follows
 * the operating system, also when it changes while the page is open.
 */
export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

const KEY = "inframole-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Inline, runs before paint: only removes `dark` when the browser chose light. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||(t==="system"&&!matchMedia("${DARK_QUERY}").matches))document.documentElement.classList.remove("dark")}catch(e){}`;

// Private mode: the choice lasts until the page is closed.
let unsaved: ThemePreference | null = null;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  if (unsaved) return unsaved;
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}

function apply(preference: ThemePreference): void {
  const dark = preference === "system" ? matchMedia(DARK_QUERY).matches : preference === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(KEY, preference);
    unsaved = null;
  } catch {
    unsaved = preference;
  }
  apply(preference);
  listeners.forEach((notify) => notify());
}

/** Sets an explicit theme (the sidebar switch). */
export function setTheme(theme: Theme): void {
  setThemePreference(theme);
}

function onSystemOrOtherTab(): void {
  apply(readPreference());
  listeners.forEach((notify) => notify());
}

function subscribePreference(onChange: () => void): () => void {
  if (!listeners.size) {
    matchMedia(DARK_QUERY).addEventListener("change", onSystemOrOtherTab);
    window.addEventListener("storage", onSystemOrOtherTab);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) {
      matchMedia(DARK_QUERY).removeEventListener("change", onSystemOrOtherTab);
      window.removeEventListener("storage", onSystemOrOtherTab);
    }
  };
}

/**
 * Applies the choice again once React has rendered the root: when React
 * recovers from a hydration error it re-creates `<html>` with the server's
 * `dark` class, after THEME_SCRIPT already ran.
 */
export function ThemeSync(): null {
  useLayoutEffect(() => apply(readPreference()), []);
  return null;
}

/** What this browser chose: dark, light or follow the system. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribePreference, readPreference, () => "dark");
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // Keeps "system" in step with the OS even where no preference control is mounted.
  const unsubscribe = subscribePreference(() => {});
  return () => {
    observer.disconnect();
    unsubscribe();
  };
}

/** The theme in use, following changes made anywhere on the page. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "dark",
  );
}
