// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { RELATIONSHIP_TYPE_INFO, RELATIONSHIP_TYPES, type RelationshipType } from "@depmap/graph";
import type { ReviewState } from "@/app/w/[slug]/suggestions/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  fromName: string;
  toName: string;
  currentType: RelationshipType;
  suggestedType: RelationshipType | null;
  confirm: (input: { type?: string; note?: string }) => Promise<ReviewState>;
  ignore: () => Promise<ReviewState>;
}

export function SuggestionActions({
  fromName,
  toName,
  currentType,
  suggestedType,
  confirm,
  ignore,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ReviewState>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
    });

  const quickType = suggestedType && suggestedType !== currentType ? suggestedType : null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <span className="text-danger text-xs">{error}</span>}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(ignore)}>
        <X /> Ignore
      </Button>
      <AddContext
        fromName={fromName}
        toName={toName}
        defaultType={suggestedType ?? currentType}
        disabled={pending}
        onSubmit={(input) => run(() => confirm(input))}
      />
      {quickType ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => confirm({ type: quickType }))}
        >
          <Check /> Confirm as “{RELATIONSHIP_TYPE_INFO[quickType].label}”
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={() => run(() => confirm({}))}>
          <Check /> Confirm
        </Button>
      )}
    </div>
  );
}

function AddContext({
  fromName,
  toName,
  defaultType,
  disabled,
  onSubmit,
}: {
  fromName: string;
  toName: string;
  defaultType: RelationshipType;
  disabled: boolean;
  onSubmit: (input: { type: string; note: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RelationshipType>(defaultType);
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled}>
          Add context…
        </Button>
      </DialogTrigger>
      <SheetContent title="Add context and confirm" description="Say what this connection means.">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ type, note });
            setOpen(false);
          }}
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type">Relationship</Label>
              <Select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as RelationshipType)}
              >
                {RELATIONSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RELATIONSHIP_TYPE_INFO[t].label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="border-border bg-surface-2 rounded-md border px-3 py-2.5 text-sm">
              <span className="font-mono">{fromName}</span>{" "}
              <span className="text-accent">{RELATIONSHIP_TYPE_INFO[type].label}</span>{" "}
              <span className="font-mono">{toName}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">Context (optional)</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Orders service reads the customer database"
              />
            </div>
          </div>
          <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Confirm</Button>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}
