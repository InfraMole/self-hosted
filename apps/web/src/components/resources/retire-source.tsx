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

/**
 * Shown when the Library is filtered by a source that no longer exists (or a
 * file import): retire what it created (ADR-021).
 */
export function RetireSourceBanner({
  label,
  count,
  removed,
  action,
}: {
  label: string;
  count: number;
  removed: boolean;
  /** Redirects to the Library with the outcome on success; returns only on error. */
  action: () => Promise<{ error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="border-warning/40 bg-warning/10 flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-xs">
      <span>
        {count} resource{count === 1 ? "" : "s"} came from{" "}
        <span className="font-medium">{label}</span>
        {removed ? ", which was removed." : "."}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">
            Retire them…
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Retire what {label} created?</DialogTitle>
          <DialogDescription>
            Resources nobody has touched are deleted. Those with notes, edits or relationships added
            by a person are archived instead, so their context is kept. Resources that already
            existed before the source (matched by name) are never affected.
          </DialogDescription>
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
                  const r = await action();
                  if (r?.error) setError(r.error);
                })
              }
            >
              {pending ? "Retiring…" : "Retire"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
