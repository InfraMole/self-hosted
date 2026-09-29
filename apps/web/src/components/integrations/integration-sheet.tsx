// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Plug, ShieldCheck } from "lucide-react";
import type { IntegrationActionState } from "@/app/w/[slug]/settings/integration-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INTEGRATION_FORMS, type IntegrationKindName } from "@/lib/integration-forms";
import type { IntegrationInput } from "@/server/modules/integrations/integrations";

interface Props {
  test: (input: IntegrationInput) => Promise<IntegrationActionState>;
  save: (input: IntegrationInput) => Promise<IntegrationActionState>;
}

export function IntegrationSheet({ test, save }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IntegrationKindName>("CLOUDFLARE");
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [syncHours, setSyncHours] = useState("6");
  const [state, setState] = useState<IntegrationActionState>({});
  const [pending, startTransition] = useTransition();
  const form = INTEGRATION_FORMS[kind];

  const input = (): IntegrationInput => ({
    kind,
    name: name || form.label,
    syncIntervalHours: Number(syncHours),
    config: Object.fromEntries(form.config.map((f) => [f.name, values[f.name] ?? ""])),
    secret: Object.fromEntries(form.secret.map((f) => [f.name, values[f.name] ?? ""])),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Never keep typed secrets around after closing.
    setValues({});
    setState({});
    setName("");
  }

  const run = (fn: () => Promise<IntegrationActionState>, closeOnSuccess = false) =>
    startTransition(async () => {
      setState({});
      const result = await fn();
      setState(result);
      if (closeOnSuccess && !result.error) {
        setValues({});
        setTimeout(() => setOpen(false), 1500);
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plug /> Add integration
        </Button>
      </DialogTrigger>
      <SheetContent
        title="Add integration"
        description="Read-only credentials, encrypted at rest, never shown again."
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => save(input()), true);
          }}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="kind">Provider</Label>
                <Select
                  id="kind"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as IntegrationKindName);
                    setValues({});
                    setState({});
                  }}
                >
                  {(Object.keys(INTEGRATION_FORMS) as IntegrationKindName[]).map((k) => (
                    <option key={k} value={k}>
                      {INTEGRATION_FORMS[k].label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="interval">Sync every</Label>
                <Select
                  id="interval"
                  value={syncHours}
                  onChange={(e) => setSyncHours(e.target.value)}
                >
                  {[1, 6, 24, 168].map((h) => (
                    <option key={h} value={h}>
                      {h === 168 ? "week" : h === 24 ? "day" : `${h} h`}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-name">Name</Label>
              <Input
                id="int-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${form.label} production`}
                maxLength={64}
              />
            </div>

            <div className="border-border bg-surface-2 flex gap-2 rounded-md border px-3 py-2.5 text-xs">
              <ShieldCheck className="text-accent mt-0.5 size-3.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-foreground">{form.permissions}</p>
                <p className="text-muted">Imports: {form.imports}</p>
              </div>
            </div>

            {[...form.config, ...form.secret].map((f) => (
              <div key={`${kind}-${f.name}`} className="flex flex-col gap-1.5">
                <Label htmlFor={`f-${f.name}`}>
                  {f.label}
                  {f.secret && <span className="text-subtle"> · encrypted</span>}
                </Label>
                <Input
                  id={`f-${f.name}`}
                  type={f.secret ? "password" : "text"}
                  autoComplete={f.secret ? "new-password" : "off"}
                  spellCheck={false}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  placeholder={f.placeholder}
                  className="font-mono text-xs"
                />
              </div>
            ))}

            {(state.message || state.error) && (
              <p
                role="status"
                className={state.error ? "text-danger text-xs" : "text-success text-xs"}
              >
                {state.error ?? state.message}
              </p>
            )}
          </div>
          <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => test(input()))}
            >
              Test connection
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Working…" : "Save & sync"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}

export function SyncNowButton({ action }: { action: () => Promise<IntegrationActionState> }) {
  const [state, setState] = useState<IntegrationActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      {state.error && (
        <span className="text-danger max-w-56 truncate text-xs" title={state.error}>
          {state.error}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => startTransition(async () => setState(await action()))}
      >
        {pending ? "Syncing…" : "Sync now"}
      </Button>
    </span>
  );
}
