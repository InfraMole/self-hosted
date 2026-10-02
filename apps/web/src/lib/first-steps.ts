// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First steps (M28): Install → Discover → Understand, ending on the question
 * that makes the product click — "if this fails, what could be affected?".
 * Client-safe. Steps that depend on what a person has looked at are kept in
 * this browser only (a convenience, never shared state).
 */

export interface FirstStepsFacts {
  resources: number;
  pendingSuggestions: number;
  confirmedRelationships: number;
  /** The resource with the most that could be affected, for the last step. */
  showcase: { id: string; name: string; affected: number } | null;
}

export type ViewedStep = "map" | "impact";
interface Stored {
  map?: boolean;
  impact?: boolean;
  hidden?: boolean;
}

const key = (slug: string) => `inframole:first-steps:${slug}`;

export function readFirstSteps(slug: string): Stored {
  try {
    return JSON.parse(localStorage.getItem(key(slug)) ?? "{}") as Stored;
  } catch {
    return {};
  }
}

const EVENT = "inframole:first-steps";

function write(slug: string, patch: Stored) {
  try {
    localStorage.setItem(key(slug), JSON.stringify({ ...readFirstSteps(slug), ...patch }));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Private mode or blocked storage: the checklist just forgets.
  }
}

/** useSyncExternalStore plumbing: the raw stored string (stable between reads). */
export function subscribeFirstSteps(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
export function rawFirstSteps(slug: string): string {
  try {
    return localStorage.getItem(key(slug)) ?? "{}";
  } catch {
    return "{}";
  }
}

export const markFirstStep = (slug: string, step: ViewedStep) => write(slug, { [step]: true });
export const hideFirstSteps = (slug: string) => write(slug, { hidden: true });

export interface FirstStep {
  id: "add" | "confirm" | "map" | "impact";
  done: boolean;
}

/** The four steps, in order, from the data and what this browser has seen. */
export function firstSteps(facts: FirstStepsFacts, seen: Stored): FirstStep[] {
  return [
    { id: "add", done: facts.resources > 0 },
    { id: "confirm", done: facts.confirmedRelationships > 0 },
    { id: "map", done: !!seen.map },
    { id: "impact", done: !!seen.impact },
  ];
}
