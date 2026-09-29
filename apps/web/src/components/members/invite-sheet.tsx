// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import type { InviteState } from "@/app/w/[slug]/settings/member-actions";
import { CopyBlock } from "@/components/agents/create-token-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Role } from "@/server/authz";

const ROLE_HELP: Record<Role, string> = {
  VIEWER: "Can see everything, change nothing.",
  MEMBER: "Can edit the library, relationships and review suggestions.",
  ADMIN: "Also manages agents, integrations and members.",
  OWNER: "Full control, including other owners.",
};

export function InviteSheet({
  action,
  canInviteOwner,
}: {
  action: (input: { email: string; role: Role }) => Promise<InviteState>;
  canInviteOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("MEMBER");
  const [state, setState] = useState<InviteState>({});
  const [pending, startTransition] = useTransition();
  const roles: Role[] = canInviteOwner
    ? ["VIEWER", "MEMBER", "ADMIN", "OWNER"]
    : ["VIEWER", "MEMBER", "ADMIN"];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setState({}); // never keep the link around
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <UserPlus /> Invite
        </Button>
      </DialogTrigger>
      <SheetContent
        title={state.link ? "Share the invitation" : "Invite a member"}
        description={
          state.link
            ? "Copy the link now — it will not be shown again. It expires in 7 days."
            : "They sign in (or create an account) with this email to join."
        }
      >
        {state.link ? (
          <div className="flex flex-1 flex-col">
            <div className="flex-1 space-y-4 px-5 py-5">
              <CopyBlock label={`Invitation link for ${state.email}`} value={state.link} />
              <p className="text-muted text-xs">
                {state.emailed
                  ? `Emailed to ${state.email}. `
                  : "Send it through a channel you trust. "}
                Only {state.email} can accept it.
              </p>
            </div>
            <div className="border-border flex justify-end border-t px-5 py-3">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              const email = String(new FormData(e.currentTarget).get("email") ?? "");
              startTransition(async () => setState(await action({ email, role })));
            }}
          >
            <div className="flex-1 space-y-4 px-5 py-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
                <p className="text-subtle text-xs">{ROLE_HELP[role]}</p>
              </div>
              {state.error && (
                <p role="alert" className="text-danger text-xs">
                  {state.error}
                </p>
              )}
            </div>
            <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create invitation"}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Dialog>
  );
}

export function RoleSelect({
  value,
  roles,
  label,
  action,
}: {
  value: Role;
  roles: Role[];
  label: string;
  action: (role: Role) => Promise<{ error?: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span className="text-danger max-w-60 truncate text-xs" title={error}>
          {error}
        </span>
      )}
      <Select
        aria-label={label}
        value={value}
        disabled={pending}
        className="h-7 w-28 text-xs"
        onChange={(e) => {
          const next = e.target.value as Role;
          startTransition(async () => {
            const result = await action(next);
            setError(result.error ?? null);
          });
        }}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0) + r.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>
    </span>
  );
}
