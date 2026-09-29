// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Check, EyeOff, RotateCcw, Search, X } from "lucide-react";
import { RELATIONSHIP_TYPE_INFO, edgeConfidence } from "@depmap/graph";
import type { BulkState, ReviewState, RuleState } from "@/app/w/[slug]/suggestions/actions";
import { ConfidenceBadge } from "@/components/relationships/confidence-badge";
import { TypeIcon } from "@/components/resources/resource-badges";
import { SuggestionActions } from "@/components/suggestions/suggestion-actions";
import {
  RuleDialog,
  type ResourceOption,
  type RulePrefill,
} from "@/components/suggestions/rule-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { SuggestionView } from "@/server/modules/discovery/discovery";

type Many = (ids: string[]) => Promise<BulkState>;

interface Filters {
  text: string;
  port: string;
  process: string;
  target: string;
}

const EMPTY: Filters = { text: "", port: "", process: "", target: "" };

/**
 * Suggestions inbox (M15, ADR-027): filter, select many, confirm / ignore in
 * one go, or turn the current filter into an exclusion rule. `mode="ignored"`
 * lists ignored suggestions with "Restore" (undo ignore).
 */
export function SuggestionInbox({
  slug,
  mode,
  suggestions,
  canReview,
  confirmOne,
  ignoreOne,
  confirmMany,
  ignoreMany,
  restoreMany,
  createRule,
}: {
  slug: string;
  mode: "review" | "ignored";
  suggestions: SuggestionView[];
  canReview: boolean;
  confirmOne?: (id: string, input: { type?: string; note?: string }) => Promise<ReviewState>;
  ignoreOne?: (id: string) => Promise<ReviewState>;
  confirmMany?: (ids: string[], useSuggestedType: boolean) => Promise<BulkState>;
  ignoreMany?: Many;
  restoreMany?: Many;
  createRule?: (input: unknown) => Promise<RuleState>;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<BulkState>({});
  const [ruleOpen, setRuleOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const base = `/w/${slug}`;

  const options = useMemo(() => {
    const ports = new Set<number>();
    const processes = new Set<string>();
    const targets = new Map<string, string>();
    const endpoints = new Map<string, string>();
    for (const s of suggestions) {
      s.evidence.ports.forEach((p) => ports.add(p));
      s.evidence.processes.forEach((p) => processes.add(p));
      targets.set(s.to.id, s.to.name);
      endpoints.set(s.to.id, s.to.name);
      endpoints.set(s.from.id, s.from.name);
    }
    const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
    return {
      ports: [...ports].sort((a, b) => a - b),
      processes: [...processes].sort((a, b) => a.localeCompare(b)),
      targets: [...targets].sort(byName),
      endpoints: [...endpoints].sort(byName).map(([id, name]): ResourceOption => ({ id, name })),
    };
  }, [suggestions]);

  const shown = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    return suggestions.filter(
      (s) =>
        (!text ||
          s.from.name.toLowerCase().includes(text) ||
          s.to.name.toLowerCase().includes(text)) &&
        (!filters.port || s.evidence.ports.includes(Number(filters.port))) &&
        (!filters.process ||
          s.evidence.processes.some((p) => p.toLowerCase() === filters.process.toLowerCase())) &&
        (!filters.target || s.to.id === filters.target),
    );
  }, [suggestions, filters]);

  const shownIds = shown.map((s) => s.id);
  const selectedShown = shownIds.filter((id) => selected.has(id));
  const allShown = shown.length > 0 && selectedShown.length === shown.length;
  const filtered = filters.port || filters.process || filters.target || filters.text;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (action: () => Promise<BulkState>) =>
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (!result.error) {
        setSelected(new Set());
        router.refresh();
      }
    });

  const prefill: RulePrefill = {
    port: filters.port ? Number(filters.port) : null,
    processName: filters.process || null,
    resourceId: filters.target || null,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={filters.text}
            onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
            placeholder="Filter by resource"
            aria-label="Filter by resource name"
            className="h-8 pl-8"
          />
        </div>
        <Select
          aria-label="Destination"
          value={filters.target}
          onChange={(e) => setFilters((f) => ({ ...f, target: e.target.value }))}
          className="w-44"
        >
          <option value="">Any destination</option>
          {options.targets.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Port"
          value={filters.port}
          onChange={(e) => setFilters((f) => ({ ...f, port: e.target.value }))}
          className="w-32"
        >
          <option value="">Any port</option>
          {options.ports.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        {options.processes.length > 0 && (
          <Select
            aria-label="Process"
            value={filters.process}
            onChange={(e) => setFilters((f) => ({ ...f, process: e.target.value }))}
            className="w-44"
          >
            <option value="">Any process</option>
            {options.processes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        )}
        {filtered && (
          <button
            type="button"
            className="text-subtle hover:text-foreground text-xs"
            onClick={() => setFilters(EMPTY)}
          >
            Clear filters
          </button>
        )}
        {mode === "review" && canReview && createRule && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={!prefill.port && !prefill.processName && !prefill.resourceId}
            title="Filter by destination, port or process first"
            onClick={() => setRuleOpen(true)}
          >
            <EyeOff /> Always ignore this traffic…
          </Button>
        )}
      </div>

      <div className="border-border bg-surface flex min-h-9 flex-wrap items-center gap-3 rounded-md border px-3 py-1.5 text-xs">
        {canReview && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allShown}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const id of shownIds) {
                    if (allShown) next.delete(id);
                    else next.add(id);
                  }
                  return next;
                })
              }
              className="accent-[var(--accent)]"
            />
            {selectedShown.length > 0
              ? `${selectedShown.length} selected`
              : `Select all ${shown.length}${filtered ? " shown" : ""}`}
          </label>
        )}
        {!canReview && (
          <span className="text-muted">
            {shown.length} {mode === "review" ? "to review" : "ignored"}
          </span>
        )}
        {canReview && selectedShown.length > 0 && mode === "review" && (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => confirmMany!(selectedShown, false))}
            >
              <Check /> Confirm
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              title="Port 1433 → uses database, 389 → authenticates with…"
              onClick={() => run(() => confirmMany!(selectedShown, true))}
            >
              Confirm with suggested types
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => ignoreMany!(selectedShown))}
            >
              <X /> Ignore
            </Button>
          </>
        )}
        {canReview && selectedShown.length > 0 && mode === "ignored" && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => restoreMany!(selectedShown))}
          >
            <RotateCcw /> Restore to inbox
          </Button>
        )}
        {(feedback.message || feedback.error) && (
          <span
            role="status"
            className={`ml-auto ${feedback.error ? "text-danger" : "text-muted"}`}
          >
            {feedback.error ?? feedback.message}
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-muted px-1 py-6 text-center text-sm">Nothing matches these filters.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((s) => {
            const e = s.evidence;
            return (
              <li
                key={s.id}
                id={s.id}
                className={`border-border rounded-lg border border-dashed px-4 py-3 ${selected.has(s.id) ? "bg-surface-2" : "bg-surface"}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {canReview && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.from.name} → ${s.to.name}`}
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="accent-[var(--accent)]"
                    />
                  )}
                  <Link
                    href={`${base}/resources/${s.from.id}/dependencies`}
                    className="hover:text-accent flex items-center gap-2 font-mono text-sm"
                  >
                    <TypeIcon type={s.from.type} />
                    {s.from.name}
                  </Link>
                  <span className="text-muted flex items-center gap-1.5 text-xs">
                    {RELATIONSHIP_TYPE_INFO[s.type].label}
                    <ArrowRight className="size-3.5" />
                  </span>
                  <Link
                    href={`${base}/resources/${s.to.id}/dependencies`}
                    className="hover:text-accent flex items-center gap-2 font-mono text-sm"
                  >
                    <TypeIcon type={s.to.type} />
                    {s.to.name}
                  </Link>
                  <span className="ml-auto">
                    <ConfidenceBadge confidence={edgeConfidence("UNCONFIRMED", s.origin)!} />
                  </span>
                </div>
                <p className="text-muted mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                  {e.ports.length > 0 && <span>port {e.ports.join(", ")}</span>}
                  {e.protocols.length > 0 && (
                    <span className="font-sans">likely {e.protocols.join(" / ")}</span>
                  )}
                  {e.processes.length > 0 && <span>{e.processes.slice(0, 3).join(", ")}</span>}
                  {e.samples > 0 && <span>{e.samples} samples</span>}
                  {e.lastSeenAt && (
                    <span className="font-sans" title={formatDateTime(e.lastSeenAt)}>
                      last seen {formatRelative(e.lastSeenAt)}
                    </span>
                  )}
                </p>
                {s.note && <p className="text-subtle mt-1 text-xs">{s.note}</p>}
                {canReview && mode === "review" && confirmOne && ignoreOne && (
                  <div className="mt-3">
                    <SuggestionActions
                      fromName={s.from.name}
                      toName={s.to.name}
                      currentType={s.type}
                      suggestedType={e.suggestedType}
                      confirm={(input) => confirmOne(s.id, input)}
                      ignore={() => ignoreOne(s.id)}
                    />
                  </div>
                )}
                {canReview && mode === "ignored" && restoreMany && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => restoreMany([s.id]))}
                    >
                      <RotateCcw /> Restore
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {createRule && (
        <RuleDialog
          open={ruleOpen}
          onOpenChange={setRuleOpen}
          resources={options.endpoints}
          prefill={prefill}
          createRule={createRule}
          onCreated={(message) => {
            setFeedback({ message });
            setFilters(EMPTY);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
