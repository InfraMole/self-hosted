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

export function RevokeButton({
  label,
  title,
  description,
  action,
  verb = "Revoke",
}: {
  label: string;
  title: string;
  description: string;
  action: () => Promise<{ error?: string }>;
  verb?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label}>
          {verb}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
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
                const result = await action();
                if (result.error) setError(result.error);
                else setOpen(false);
              })
            }
          >
            {pending ? "Working…" : verb}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
