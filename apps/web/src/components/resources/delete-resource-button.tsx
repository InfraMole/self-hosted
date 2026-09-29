// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  name: string;
  action: () => Promise<{ error?: string }>;
}

export function DeleteResourceButton({ name, action }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await action(); // redirects on success
      if (result?.error) setError(result.error);
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Delete ${name}`}>
          <Trash2 /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>
          Delete <span className="font-mono">{name}</span>?
        </DialogTitle>
        <DialogDescription>
          The resource is removed from the Library. Its activity history is kept.
        </DialogDescription>
        {error && <p className="text-danger mt-3 text-xs">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
