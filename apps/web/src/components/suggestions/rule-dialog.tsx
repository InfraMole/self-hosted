// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import type { RuleState } from "@/app/w/[slug]/suggestions/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ResourceOption {
  id: string;
  name: string;
}

export interface RulePrefill {
  port: number | null;
  processName: string | null;
  resourceId: string | null;
}

const NONE: RulePrefill = { port: null, processName: null, resourceId: null };

/**
 * "Always ignore this traffic" (M15, ADR-027): an exclusion rule with any
 * combination of port, process and resource (all must match).
 */
export function RuleDialog({
  open,
  onOpenChange,
  resources,
  prefill = NONE,
  createRule,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: ResourceOption[];
  prefill?: RulePrefill;
  createRule: (input: unknown) => Promise<RuleState>;
  onCreated?: (message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Always ignore this traffic"
        description="Connections matching every field you fill in never become suggestions. Matching suggestions waiting for review are removed. You can delete the rule later."
      >
        {open && (
          <RuleForm
            key={`${prefill.port}|${prefill.processName}|${prefill.resourceId}`}
            resources={resources}
            prefill={prefill}
            createRule={createRule}
            onDone={(message) => {
              onOpenChange(false);
              onCreated?.(message);
            }}
          />
        )}
      </SheetContent>
    </Dialog>
  );
}

function RuleForm({
  resources,
  prefill,
  createRule,
  onDone,
}: {
  resources: ResourceOption[];
  prefill: RulePrefill;
  createRule: (input: unknown) => Promise<RuleState>;
  onDone: (message: string) => void;
}) {
  const [port, setPort] = useState(prefill.port?.toString() ?? "");
  const [processName, setProcessName] = useState(prefill.processName ?? "");
  const [resourceId, setResourceId] = useState(prefill.resourceId ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<RuleState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createRule({
            port: port.trim() || null,
            processName,
            resourceId,
            note,
          });
          setState(result);
          if (result.ok) onDone(result.message ?? "Rule added.");
        });
      }}
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-port">Port</Label>
          <Input
            id="rule-port"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="Any port — e.g. 9102"
            aria-invalid={!!state.fieldErrors?.port}
            className="font-mono"
          />
          {state.fieldErrors?.port && (
            <p className="text-danger text-xs">{state.fieldErrors.port}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-process">Process</Label>
          <Input
            id="rule-process"
            value={processName}
            onChange={(e) => setProcessName(e.target.value)}
            placeholder="Any process — e.g. MsMpEng.exe"
            maxLength={128}
            className="font-mono"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-resource">Resource (either end)</Label>
          <Select
            id="rule-resource"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
          >
            <option value="">Any resource</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-note">Why (optional)</Label>
          <Textarea
            id="rule-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Backup agent traffic, not a dependency"
          />
        </div>
        {state.error && <p className="text-danger text-sm">{state.error}</p>}
      </div>
      <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}
