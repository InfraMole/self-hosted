// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspaceAction, type CreateWorkspaceState } from "./actions";

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState<CreateWorkspaceState, FormData>(
    createWorkspaceAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Acme Infrastructure"
          required
          maxLength={64}
          autoFocus
          aria-invalid={state.error ? true : undefined}
        />
      </div>
      {state.error && (
        <p role="alert" className="text-danger text-xs">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
