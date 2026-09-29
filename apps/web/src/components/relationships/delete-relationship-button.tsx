// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import type { RelationshipFormState } from "@/app/w/[slug]/resources/relationship-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeleteRelationshipButton({
  sentence,
  action,
}: {
  sentence: string;
  action: () => Promise<RelationshipFormState>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Remove relationship: ${sentence}`}
          className="text-subtle hover:bg-surface-2 hover:text-danger rounded p-1"
        >
          <Trash2 className="size-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Remove relationship?</DialogTitle>
        <DialogDescription className="font-mono text-xs">{sentence}</DialogDescription>
        {error && <p className="text-danger mt-3 text-xs">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
