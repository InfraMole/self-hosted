// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import type { CreateTokenState } from "@/app/w/[slug]/settings/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AGENT_ASSETS, installCommands } from "@/lib/agent-install";

const EXPIRY = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

export function CreateTokenDialog({
  action,
}: {
  action: (formData: FormData) => Promise<CreateTokenState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CreateTokenState>({});
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setState({}); // never keep the plaintext token around
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => setState(await action(formData)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <KeyRound /> New enrollment token
        </Button>
      </DialogTrigger>
      <SheetContent
        title={state.token ? "Install the agent" : "New enrollment token"}
        description={
          state.token
            ? "Copy the token now — it will not be shown again."
            : "A token lets agents join this workspace. Each agent then gets its own credential."
        }
      >
        {state.token ? (
          <TokenResult state={state} />
        ) : (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="Production servers"
                  maxLength={64}
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="expiresInHours">Expires in</Label>
                  <Select id="expiresInHours" name="expiresInHours" defaultValue="168">
                    {EXPIRY.map((e) => (
                      <option key={e.hours} value={e.hours}>
                        {e.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maxUses">Max agents (optional)</Label>
                  <Input
                    id="maxUses"
                    name="maxUses"
                    type="number"
                    min={1}
                    max={1000}
                    placeholder="Unlimited"
                  />
                </div>
              </div>
              <p className="text-subtle text-xs leading-relaxed">
                The agent is read-only and outbound-only. It reports host facts, running services,
                listening ports and TCP connections — never passwords, files, command lines or
                environment variables. The server cannot send it commands.
              </p>
            </div>
            <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
              <p role="alert" className="text-danger min-w-0 truncate text-xs">
                {state.error ?? ""}
              </p>
              <div className="flex shrink-0 gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                  {pending ? "Creating…" : "Create token"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </SheetContent>
    </Dialog>
  );
}

function TokenResult({ state }: { state: CreateTokenState }) {
  const base = state.downloadBaseUrl?.replace(/\/+$/, "");
  const { windows, linux } = installCommands({
    token: state.token!,
    serverUrl: state.serverUrl!,
    insecure: Boolean(state.insecure),
    downloadBaseUrl: base,
  });

  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
      <CopyBlock label="Enrollment token" value={state.token!} />
      <div className="text-muted text-xs">
        Expires {new Date(state.expiresAt!).toLocaleString()}. Want to see exactly what will be sent
        first? Run <code className="text-foreground font-mono">inframole-agent dry-run</code> — it
        prints the report and sends nothing.
      </div>
      <CopyBlock label="Windows (PowerShell as Administrator)" value={windows} />
      <CopyBlock label="Linux (root)" value={linux} />
      {state.insecure && (
        <p className="text-warning text-xs">
          This server uses http://, so the commands include --insecure-dev. Use https:// in
          production.
        </p>
      )}
      {base ? (
        <div className="text-subtle space-y-1.5 text-xs">
          <p>
            The commands verify the download against the signed{" "}
            <code className="font-mono">SHA256SUMS</code> before installing (signature verification
            with cosign: docs/AGENT.md §10). Direct downloads:
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            {AGENT_ASSETS.map((a) => (
              <a
                key={a.file}
                href={`${base}/${a.file}`}
                rel="noopener noreferrer"
                className="text-foreground underline-offset-4 hover:underline"
              >
                {a.label}
              </a>
            ))}
          </p>
        </div>
      ) : (
        <p className="text-subtle text-xs">
          Binaries: build from <code className="font-mono">agent/</code> (see agent/README.md), or
          set <code className="font-mono">AGENT_DOWNLOAD_BASE_URL</code> to your signed releases.
        </p>
      )}
      <p className="text-subtle text-xs">
        Remove with <code className="font-mono">inframole-agent uninstall</code>.
      </p>
      <DialogClose asChild>
        <Button variant="secondary" className="w-full">
          Done
        </Button>
      </DialogClose>
    </div>
  );
}

export function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-muted text-xs font-medium">{label}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-subtle hover:text-foreground inline-flex items-center gap-1 text-xs"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="border-border bg-background overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">
        {value}
      </pre>
    </div>
  );
}
