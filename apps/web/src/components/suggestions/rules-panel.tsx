// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, EyeOff, Plus, Trash2 } from "lucide-react";
import type { RuleState } from "@/app/w/[slug]/suggestions/actions";
import { RuleDialog, type ResourceOption } from "@/components/suggestions/rule-dialog";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  RULE_TEMPLATE_CATEGORIES,
  describeTemplate,
  type RuleTemplate,
  type RuleTemplateCategory,
} from "@/lib/rule-templates";

export interface TemplateRow extends RuleTemplate {
  added: boolean;
  matches: number;
}

export interface RuleRow {
  id: string;
  port: number | null;
  processName: string | null;
  resource: { id: string; name: string } | null;
  note: string | null;
  createdAt: Date;
}

/** Exclusion rules of the workspace (M15): list, add, remove. */
export function RulesPanel({
  rules,
  resources,
  canEdit,
  createRule,
  deleteRule,
  templates,
  applyTemplate,
}: {
  rules: RuleRow[];
  resources: ResourceOption[];
  canEdit: boolean;
  createRule: (input: unknown) => Promise<RuleState>;
  deleteRule: (id: string) => Promise<RuleState>;
  templates: TemplateRow[];
  applyTemplate: (id: string) => Promise<RuleState>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<RuleState>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-muted max-w-2xl text-xs">
          Traffic matching a rule never becomes a suggestion — for example backup, antivirus or
          monitoring connections. Every field of a rule must match.
        </p>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
            <Plus /> Add rule
          </Button>
        )}
      </div>
      {(feedback.message || feedback.error) && (
        <p role="status" className={`text-xs ${feedback.error ? "text-danger" : "text-muted"}`}>
          {feedback.error ?? feedback.message}
        </p>
      )}
      {rules.length === 0 ? (
        <div className="border-border text-muted flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          <EyeOff className="text-subtle size-5" />
          No rules yet. In the inbox, filter by a port, process or destination and choose “Always
          ignore this traffic…”.
        </div>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {r.port !== null && <Chip label="port" value={String(r.port)} />}
                {r.processName && <Chip label="process" value={r.processName} />}
                {r.resource && <Chip label="to or from" value={r.resource.name} />}
              </div>
              {r.note && <span className="text-muted text-xs">{r.note}</span>}
              <span className="text-subtle ml-auto text-xs" title={formatDateTime(r.createdAt)}>
                added {formatRelative(r.createdAt)}
              </span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label="Remove rule"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteRule(r.id);
                      setFeedback(result);
                      if (result.ok) router.refresh();
                    })
                  }
                >
                  <Trash2 /> Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <SuggestedRules
        templates={templates}
        canEdit={canEdit}
        pending={pending}
        onApply={(id) =>
          startTransition(async () => {
            const result = await applyTemplate(id);
            setFeedback(result);
            if (result.ok) router.refresh();
          })
        }
      />
      <RuleDialog
        open={open}
        onOpenChange={setOpen}
        resources={resources}
        createRule={createRule}
        onCreated={(message) => {
          setFeedback({ message });
          router.refresh();
        }}
      />
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="border-border bg-surface inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs">
      <span className="text-subtle">{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

/** M19: a curated catalogue, one click per entry, never applied automatically. */
function SuggestedRules({
  templates,
  canEdit,
  pending,
  onApply,
}: {
  templates: TemplateRow[];
  canEdit: boolean;
  pending: boolean;
  onApply: (id: string) => void;
}) {
  const categories = Object.keys(RULE_TEMPLATE_CATEGORIES) as RuleTemplateCategory[];
  return (
    <section aria-labelledby="suggested-rules" className="mt-6 flex flex-col gap-3">
      <div>
        <h2 id="suggested-rules" className="text-sm font-semibold">
          Suggested rules
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-xs">
          Common traffic that is almost never an application dependency. Nothing is applied until
          you add it; each rule can be removed later.
        </p>
      </div>
      {categories.map((cat) => {
        const items = templates.filter((t) => t.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="flex flex-col gap-2">
            <h3 className="text-subtle text-[11px] font-medium tracking-wider uppercase">
              {RULE_TEMPLATE_CATEGORIES[cat]}
            </h3>
            <ul className="grid gap-2 md:grid-cols-2">
              {items.map((t) => (
                <li
                  key={t.id}
                  className="border-border bg-surface flex items-start gap-3 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-muted mt-0.5 text-xs">{t.description}</p>
                    <p className="text-subtle mt-1 font-mono text-[11px]">
                      {describeTemplate(t)}
                      {t.matches > 0 && (
                        <span className="text-accent font-sans">
                          {" "}
                          · matches {t.matches} suggestion{t.matches === 1 ? "" : "s"} now
                        </span>
                      )}
                    </p>
                  </div>
                  {t.added ? (
                    <span className="text-muted flex items-center gap-1 text-xs">
                      <Check className="size-3.5" /> Added
                    </span>
                  ) : (
                    canEdit && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        aria-label={`Add rule: ${t.name}`}
                        onClick={() => onApply(t.id)}
                      >
                        <Plus /> Add
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
