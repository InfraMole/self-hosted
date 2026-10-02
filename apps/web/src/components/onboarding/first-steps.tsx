// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import {
  firstSteps,
  hideFirstSteps,
  markFirstStep,
  rawFirstSteps,
  subscribeFirstSteps,
  type FirstStep,
  type FirstStepsFacts,
  type ViewedStep,
} from "@/lib/first-steps";
import { cn } from "@/lib/utils";

interface Props {
  slug: string;
  facts: FirstStepsFacts;
  /** What the viewer's role allows (admins add agents and integrations). */
  canAdd: { sources: boolean; import: boolean };
}

/**
 * First steps (M28): the four steps to the first "what could be affected?",
 * shown on top of the Library until they are done or hidden.
 */
export function FirstSteps({ slug, facts, canAdd }: Props) {
  // null on the server: never flash the card for people who hid it.
  const raw = useSyncExternalStore(
    subscribeFirstSteps,
    () => rawFirstSteps(slug),
    () => null,
  );
  if (raw === null) return null;
  let seen: { map?: boolean; impact?: boolean; hidden?: boolean } = {};
  try {
    seen = JSON.parse(raw);
  } catch {
    // Unreadable: start over.
  }
  if (seen.hidden) return null;
  const steps = firstSteps(facts, seen);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!.id;

  return (
    <section
      aria-label="First steps"
      className="border-accent/40 bg-surface rounded-lg border px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-accent font-mono text-xs">
            first steps · {done} of {steps.length}
          </p>
          <h2 className="mt-1 text-sm font-semibold">
            From your servers to “if this fails, what could be affected?”
          </h2>
        </div>
        <button
          type="button"
          onClick={() => hideFirstSteps(slug)}
          aria-label="Hide first steps"
          className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-4">
        {steps.map((step, i) => (
          <Step
            key={step.id}
            n={i + 1}
            step={step}
            current={step.id === next}
            slug={slug}
            facts={facts}
            canAdd={canAdd}
          />
        ))}
      </ol>
    </section>
  );
}

const TITLES: Record<FirstStep["id"], string> = {
  add: "Add your infrastructure",
  confirm: "Confirm what depends on what",
  map: "See it on the map",
  impact: "Ask what could be affected",
};

function Step({
  n,
  step,
  current,
  slug,
  facts,
  canAdd,
}: {
  n: number;
  step: FirstStep;
  current: boolean;
  slug: string;
  facts: FirstStepsFacts;
  canAdd: Props["canAdd"];
}) {
  const links: { href: string; label: string }[] = [];
  let body = "";
  switch (step.id) {
    case "add":
      body = "An agent on a server, a cloud or NAS integration, or a file.";
      if (canAdd.sources) {
        links.push({ href: `/w/${slug}/settings#agents`, label: "Install the agent" });
        links.push({ href: `/w/${slug}/settings#integrations`, label: "Connect a source" });
      }
      if (canAdd.import) links.push({ href: `/w/${slug}/library/import`, label: "Import a file" });
      if (!canAdd.sources && !canAdd.import) body += " Ask a workspace admin.";
      break;
    case "confirm":
      if (facts.pendingSuggestions > 0) {
        body = `${facts.pendingSuggestions} connection${facts.pendingSuggestions === 1 ? "" : "s"} seen by agents or integrations, waiting for you.`;
        links.push({ href: `/w/${slug}/suggestions`, label: "Review suggestions" });
      } else {
        body =
          "Agents suggest what talks to what; you confirm. You can also add a relationship on any resource.";
      }
      break;
    case "map":
      body = "Drawn from your Library — never by hand.";
      links.push({ href: `/w/${slug}/map`, label: "Open the map" });
      break;
    case "impact":
      if (facts.showcase) {
        body = `If ${facts.showcase.name} fails, ${facts.showcase.affected} resource${facts.showcase.affected === 1 ? "" : "s"} could be affected.`;
        links.push({
          href: `/w/${slug}/map?impact=${facts.showcase.id}`,
          label: `See what depends on ${facts.showcase.name}`,
        });
      } else {
        body = "Pick a resource on the map and choose Impact.";
      }
      break;
  }
  return (
    <li
      className={cn(
        "rounded-md border px-3 py-2.5",
        current ? "border-accent/50 bg-surface-2" : "border-border",
        step.done && "opacity-60",
      )}
    >
      <p className="flex items-center gap-2 text-xs font-medium">
        <span
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]",
            step.done ? "border-success text-success" : "border-border-strong text-muted",
          )}
          aria-hidden
        >
          {step.done ? <Check className="size-3" /> : n}
        </span>
        {TITLES[step.id]}
        {step.done && <span className="sr-only">(done)</span>}
      </p>
      <p className="text-muted mt-1 text-xs leading-relaxed">{body}</p>
      {!step.done && links.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              {l.label} <ArrowRight className="size-3" />
            </Link>
          ))}
        </p>
      )}
    </li>
  );
}

/** Marks a viewed step from a page (the map marks its own). */
export function MarkFirstStep({ slug, step }: { slug: string; step: ViewedStep }) {
  useEffect(() => markFirstStep(slug, step), [slug, step]);
  return null;
}
