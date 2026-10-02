// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import type { CreateApiTokenState } from "@/app/w/[slug]/settings/api-actions";
import { CopyBlock } from "@/components/agents/create-token-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const EXPIRY = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Never" },
];

/** New read-only API token (M30): name + expiry, then the token shown once. */
export function CreateApiTokenDialog({
  action,
}: {
  action: (formData: FormData) => Promise<CreateApiTokenState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CreateApiTokenState>({});
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
        <Button size="sm" variant="secondary">
          <KeyRound /> New API token
        </Button>
      </DialogTrigger>
      <SheetContent
        title={state.token ? "API token created" : "New API token"}
        description={
          state.token
            ? "Copy the token now — it will not be shown again."
            : "A read-only token for scripts and other tools: it can read this workspace, never change it."
        }
      >
        {state.token ? (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <CopyBlock label="API token" value={state.token} />
            <p className="text-muted text-xs">
              {state.expiresAt
                ? `Expires ${new Date(state.expiresAt).toLocaleString()}.`
                : "Does not expire — revoke it when you no longer need it."}
            </p>
            <CopyBlock
              label="Try it"
              value={`curl -H "Authorization: Bearer ${state.token}" \\\n  ${state.serverUrl}/api/v1/resources`}
            />
            <p className="text-subtle text-xs">
              Endpoints and examples:{" "}
              <Link href="/docs/reference/api" className="text-foreground underline">
                API reference
              </Link>
              .
            </p>
            <DialogClose asChild>
              <Button variant="secondary" className="w-full">
                Done
              </Button>
            </DialogClose>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-name">Name</Label>
                <Input
                  id="api-name"
                  name="name"
                  placeholder="Reporting script"
                  maxLength={64}
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expiresInDays">Expires in</Label>
                <Select id="expiresInDays" name="expiresInDays" defaultValue="90">
                  {EXPIRY.map((e) => (
                    <option key={e.days} value={e.days}>
                      {e.label}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-subtle text-xs leading-relaxed">
                The token reads resources, relationships, impact and paths — what a viewer of this
                workspace can see, including owners and notes. Treat it like a password.
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
