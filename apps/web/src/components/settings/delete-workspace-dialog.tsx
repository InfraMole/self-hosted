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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteWorkspaceDialog({
  name,
  action,
}: {
  name: string;
  action: (confirmName: string) => Promise<{ error?: string }>;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog onOpenChange={() => (setTyped(""), setError(null))}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete “{name}”?</DialogTitle>
        <DialogDescription>
          Everything in it is deleted permanently: resources, relationships, agents (they stop
          working), integrations and their stored credentials, invitations, changes and the audit
          log. Export the data first if you may need it. This cannot be undone.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="confirm-name">
            Type <span className="font-mono">{name}</span> to confirm
          </Label>
          <Input
            id="confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error && <p className="text-danger mt-3 text-xs">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={typed.trim() !== name || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await action(typed);
                if (result?.error) setError(result.error);
              })
            }
          >
            {pending ? "Deleting…" : "Delete everything"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
