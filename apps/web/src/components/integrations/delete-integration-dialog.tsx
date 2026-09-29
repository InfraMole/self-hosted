// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Delete an integration, optionally retiring what it created (ADR-021). */
export function DeleteIntegrationDialog({
  name,
  owned,
  action,
}: {
  name: string;
  /** Non-archived resources this integration created. */
  owned: number;
  action: (retire: boolean) => Promise<{ error?: string; message?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [retire, setRetire] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Delete integration ${name}`}>
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete integration “{name}”?</DialogTitle>
        <DialogDescription>
          The stored credential is destroyed. Revoke it at the provider too.
        </DialogDescription>
        {owned > 0 && (
          <label className="border-border mt-4 flex gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              checked={retire}
              onChange={(e) => setRetire(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              Also retire the {owned} resource{owned === 1 ? "" : "s"} it created
              <span className="text-muted block text-xs">
                Untouched ones are deleted; those with notes, edits or relationships added by a
                person are archived. Resources that existed before it are never affected.
              </span>
            </span>
          </label>
        )}
        {error && <p className="text-danger mt-3 text-xs">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await action(owned > 0 && retire);
                if (result.error) setError(result.error);
                else setOpen(false);
              })
            }
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
