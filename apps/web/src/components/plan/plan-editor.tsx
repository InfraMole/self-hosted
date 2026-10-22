// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { TypeIcon } from "@/components/resources/resource-badges";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLAN_TITLE_MAX, PLAN_WHEN_MAX, planHref } from "@/lib/change-plan";
import type { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { CHANGE_LIMIT } from "@depmap/graph";

type ResourceType = keyof typeof RESOURCE_TYPES;

export interface PlanPick {
  id: string;
  name: string;
  type: string;
}

/**
 * Plan a change (M34): title, when and the resources that change. Every edit
 * rewrites the URL — the plan lives there, nothing is stored — and the page
 * recomputes the impact on the server.
 */
export function PlanEditor({
  slug,
  picks,
  title: initialTitle,
  when: initialWhen,
  search,
}: {
  slug: string;
  picks: PlanPick[];
  title: string;
  when: string;
  search: (q: string) => Promise<PlanPick[]>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [when, setWhen] = useState(initialWhen);
  // The URL changed elsewhere (back button, a link): show its values. Only the
  // field that changed is reset, so typing in the other one is never lost
  // while the first one's navigation completes.
  const [shown, setShown] = useState({ title: initialTitle, when: initialWhen });
  if (shown.title !== initialTitle || shown.when !== initialWhen) {
    setShown({ title: initialTitle, when: initialWhen });
    if (shown.title !== initialTitle) setTitle(initialTitle);
    if (shown.when !== initialWhen) setWhen(initialWhen);
  }
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlanPick[]>([]);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);

  const go = (next: { ids?: string[]; title?: string; when?: string }) =>
    startTransition(() =>
      router.replace(
        planHref(slug, {
          ids: next.ids ?? picks.map((p) => p.id),
          title: next.title ?? title,
          when: next.when ?? when,
        }),
        { scroll: false },
      ),
    );

  // Debounced resource search; only the latest answer is shown.
  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    if (!query) return;
    const timer = setTimeout(async () => {
      const result = await search(query);
      if (id === seq.current) setHits(result);
    }, 150);
    return () => clearTimeout(timer);
  }, [q, search]);

  const chosen = new Set(picks.map((p) => p.id));
  const options = q.trim() ? hits.filter((h) => !chosen.has(h.id)) : [];
  const full = picks.length >= CHANGE_LIMIT;
  const add = (hit: PlanPick) => {
    setQ("");
    setHits([]);
    go({ ids: [...picks.map((p) => p.id), hit.id] });
  };

  return (
    <div className="border-border bg-surface space-y-4 rounded-lg border p-4 print:hidden">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-title">Change</Label>
          <Input
            id="plan-title"
            value={title}
            maxLength={PLAN_TITLE_MAX}
            placeholder="Reboot SQL01 and APP02 for patching"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== initialTitle && go({ title })}
            onKeyDown={(e) => e.key === "Enter" && go({ title })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan-when">When (optional)</Label>
          <Input
            id="plan-when"
            value={when}
            maxLength={PLAN_WHEN_MAX}
            placeholder="Sat 25 Oct, 22:00–23:00"
            onChange={(e) => setWhen(e.target.value)}
            onBlur={() => when !== initialWhen && go({ when })}
            onKeyDown={(e) => e.key === "Enter" && go({ when })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          What changes{" "}
          <span className="text-subtle font-mono text-xs">
            {picks.length}/{CHANGE_LIMIT}
          </span>
        </p>
        {picks.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Resources in this change">
            {picks.map((p) => (
              <li
                key={p.id}
                className="border-border-strong bg-surface-2 inline-flex h-7 items-center gap-1.5 rounded border pr-1 pl-2 font-mono text-xs"
              >
                <TypeIcon type={p.type as ResourceType} className="size-3.5" />
                {p.name}
                <button
                  type="button"
                  aria-label={`Remove ${p.name} from the change`}
                  disabled={pending}
                  onClick={() => go({ ids: picks.filter((x) => x.id !== p.id).map((x) => x.id) })}
                  className="text-subtle hover:text-foreground rounded p-0.5"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {!full && (
          <div className="relative max-w-md">
            <Search className="text-subtle pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && options[0]) {
                  e.preventDefault();
                  add(options[0]);
                }
              }}
              placeholder="Add a resource: name, IP, owner…"
              aria-label="Add a resource to the change"
              className="pl-8"
            />
            {options.length > 0 && (
              <ul className="border-border-strong bg-surface absolute z-20 mt-1 w-full overflow-hidden rounded-md border shadow-lg shadow-black/30">
                {options.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => add(h)}
                      className="hover:bg-surface-2 flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
                    >
                      <Plus className="text-subtle size-3.5" />
                      <TypeIcon type={h.type as ResourceType} className="size-3.5" />
                      {h.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
