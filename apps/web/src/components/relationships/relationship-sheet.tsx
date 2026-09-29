// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { RELATIONSHIP_TYPE_INFO, RELATIONSHIP_TYPES, type RelationshipType } from "@depmap/graph";
import type { RelationshipFormState } from "@/app/w/[slug]/resources/relationship-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";

export interface CandidateResource {
  id: string;
  name: string;
  type: keyof typeof RESOURCE_TYPES;
}

type Direction = "outgoing" | "incoming";

interface Props {
  mode: "create" | "edit";
  viewer: { id: string; name: string };
  /** create: every other resource in the workspace. */
  candidates?: CandidateResource[];
  /** edit: the fixed other end and direction. */
  fixed?: { other: CandidateResource; direction: Direction };
  initial?: { type: RelationshipType; note: string };
  action: (formData: FormData) => Promise<RelationshipFormState>;
  trigger: React.ReactNode;
}

const GROUPS: { label: string; propagation: "reverse" | "forward" | "none" }[] = [
  { label: "Dependency", propagation: "reverse" },
  { label: "Hosting", propagation: "forward" },
  { label: "Informational (no impact)", propagation: "none" },
];

export function RelationshipSheet({
  mode,
  viewer,
  candidates = [],
  fixed,
  initial,
  action,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RelationshipFormState>({});
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<RelationshipType | "">(initial?.type ?? "");
  const [direction, setDirection] = useState<Direction>(fixed?.direction ?? "outgoing");
  const [otherId, setOtherId] = useState(fixed?.other.id ?? "");

  const other = fixed?.other ?? candidates.find((c) => c.id === otherId);

  /** Clear a field's error as soon as the user changes it. */
  function clearError(field: string) {
    setState((s) =>
      s.fieldErrors?.[field] ? { ...s, fieldErrors: { ...s.fieldErrors, [field]: "" } } : s,
    );
  }
  const err = state.fieldErrors ?? {};

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setState({});
      setType(initial?.type ?? "");
      setDirection(fixed?.direction ?? "outgoing");
      setOtherId(fixed?.other.id ?? "");
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await action(formData);
      setState(result);
      if (result.ok) setOpen(false);
    });
  }

  const byType = new Map<string, CandidateResource[]>();
  for (const c of candidates) byType.set(c.type, [...(byType.get(c.type) ?? []), c]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <SheetContent
        title={mode === "create" ? "Add relationship" : "Edit relationship"}
        description={`From the point of view of ${viewer.name}`}
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {mode === "create" && (
              <div className="flex flex-col gap-1.5">
                <Label>Direction</Label>
                <div className="border-border-strong grid grid-cols-2 rounded-md border p-0.5">
                  {(["outgoing", "incoming"] as const).map((d) => (
                    <label
                      key={d}
                      className={cn(
                        "cursor-pointer rounded px-2 py-1.5 text-center text-xs",
                        direction === d ? "bg-surface-2 text-foreground" : "text-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="direction"
                        value={d}
                        checked={direction === d}
                        onChange={() => setDirection(d)}
                        className="sr-only"
                      />
                      {d === "outgoing" ? `${viewer.name} → other` : `other → ${viewer.name}`}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type">Relationship</Label>
              <Select
                id="type"
                name="type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as RelationshipType);
                  clearError("type");
                }}
                aria-invalid={!!err.type}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {RELATIONSHIP_TYPES.filter(
                      (t) => RELATIONSHIP_TYPE_INFO[t].propagation === group.propagation,
                    ).map((t) => (
                      <option key={t} value={t}>
                        {RELATIONSHIP_TYPE_INFO[t].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {err.type && <p className="text-danger text-[11px]">{err.type}</p>}
            </div>

            {mode === "create" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="otherResourceId">
                  {direction === "outgoing" ? "Target resource" : "Source resource"}
                </Label>
                <Select
                  id="otherResourceId"
                  name="otherResourceId"
                  value={otherId}
                  onChange={(e) => {
                    setOtherId(e.target.value);
                    clearError("otherResourceId");
                  }}
                  aria-invalid={!!err.otherResourceId}
                >
                  <option value="" disabled>
                    Choose a resource…
                  </option>
                  {[...byType.entries()].map(([t, list]) => (
                    <optgroup key={t} label={RESOURCE_TYPES[t as CandidateResource["type"]].label}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                {err.otherResourceId && (
                  <p className="text-danger text-[11px]">{err.otherResourceId}</p>
                )}
              </div>
            ) : null}

            <Preview viewer={viewer.name} other={other?.name} type={type} direction={direction} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">Context (optional)</Label>
              <Textarea
                id="note"
                name="note"
                defaultValue={initial?.note ?? ""}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Nightly sync job, read-only credentials"
              />
            </div>
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
                {pending ? "Saving…" : mode === "create" ? "Add relationship" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}

/** Reads the edge as a sentence and explains what it means for impact. */
function Preview({
  viewer,
  other,
  type,
  direction,
}: {
  viewer: string;
  other?: string;
  type: RelationshipType | "";
  direction: Direction;
}) {
  if (!type || !other) {
    return (
      <p className="border-border text-subtle rounded-md border border-dashed px-3 py-2.5 text-xs">
        Pick a relationship and a resource to preview it.
      </p>
    );
  }
  const info = RELATIONSHIP_TYPE_INFO[type];
  const [from, to] = direction === "outgoing" ? [viewer, other] : [other, viewer];
  const meaning =
    info.propagation === "none"
      ? "Informational: not used for impact."
      : info.propagation === "reverse"
        ? `If ${to} fails, ${from} could be affected.`
        : `If ${from} fails, ${to} could be affected.`;

  return (
    <div className="border-border bg-surface-2 rounded-md border px-3 py-2.5">
      <p className="text-sm">
        <span className="font-mono">{from}</span> <span className="text-accent">{info.label}</span>{" "}
        <span className="font-mono">{to}</span>
      </p>
      <p className="text-muted mt-1 text-xs">{meaning}</p>
    </div>
  );
}
