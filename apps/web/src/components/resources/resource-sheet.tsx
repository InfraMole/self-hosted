// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { ResourceFormState } from "@/app/w/[slug]/resources/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CRITICALITIES,
  ENVIRONMENTS,
  RESOURCE_TYPES,
  STATUSES,
  entries,
} from "@/lib/resource-presentation";
import { EMPTY_FORM_VALUES, type ResourceFormValues } from "./form-values";

interface ResourceSheetProps {
  mode: "create" | "edit";
  workspaceSlug: string;
  action: (formData: FormData) => Promise<ResourceFormState>;
  initial?: ResourceFormValues;
  trigger: React.ReactNode;
}

export function ResourceSheet({
  mode,
  workspaceSlug,
  action,
  initial = EMPTY_FORM_VALUES,
  trigger,
}: ResourceSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ResourceFormState>({});
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setState({});
  }

  const form = useRef<HTMLFormElement>(null);

  // Manual submit (not <form action>) so React does not reset the fields on errors.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  }

  /** Same name exists (M31): save anyway once the user has seen it. */
  function saveAnyway() {
    if (!form.current) return;
    const formData = new FormData(form.current);
    formData.set("confirmDuplicate", "1");
    submit(formData);
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      setState(result);
      if (result.ok) {
        setOpen(false);
        if (mode === "create") router.push(`/w/${workspaceSlug}/resources/${result.resourceId}`);
      }
    });
  }

  const err = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <SheetContent
        title={mode === "create" ? "New resource" : `Edit ${initial.name}`}
        description="No passwords or secrets — this is a map, not a vault."
      >
        <form
          ref={form}
          onSubmit={onSubmit}
          onChange={(e) => {
            // Clear a field's error as soon as the user edits it.
            const name = (e.target as unknown as { name?: string }).name ?? "";
            if (state.fieldErrors?.[name]) {
              setState((s) => ({ ...s, fieldErrors: { ...s.fieldErrors, [name]: "" } }));
            }
            if (name === "name" && state.duplicates) setState((s) => ({ ...s, duplicates: [] }));
          }}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <Section title="Basics">
              <Field label="Name" name="name" error={err.name}>
                <Input
                  id="name"
                  name="name"
                  defaultValue={initial.name}
                  maxLength={128}
                  placeholder="APP01"
                  className="font-mono"
                  autoFocus
                  aria-invalid={!!err.name}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type" name="type" error={err.type}>
                  <Select
                    id="type"
                    name="type"
                    defaultValue={initial.type}
                    aria-invalid={!!err.type}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {entries(RESOURCE_TYPES).map(([value, { label }]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Environment" name="environment" error={err.environment}>
                  <Select id="environment" name="environment" defaultValue={initial.environment}>
                    <option value="">Unspecified</option>
                    {entries(ENVIRONMENTS).map(([value, { label }]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Criticality" name="criticality" error={err.criticality}>
                  <Select id="criticality" name="criticality" defaultValue={initial.criticality}>
                    <option value="">Unspecified</option>
                    {entries(CRITICALITIES).map(([value, { label }]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {mode === "edit" && (
                  <Field label="Status" name="status" error={err.status}>
                    <Select id="status" name="status" defaultValue={initial.status}>
                      {(["ACTIVE", "ARCHIVED"] as const).map((value) => (
                        <option key={value} value={value}>
                          {STATUSES[value].label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            </Section>

            <Section title="Identity">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hostname" name="hostname" error={err.hostname}>
                  <Input
                    id="hostname"
                    name="hostname"
                    defaultValue={initial.hostname}
                    className="font-mono"
                  />
                </Field>
                <Field label="FQDN" name="fqdn" error={err.fqdn}>
                  <Input id="fqdn" name="fqdn" defaultValue={initial.fqdn} className="font-mono" />
                </Field>
                <Field label="OS / platform" name="os" error={err.os}>
                  <Input
                    id="os"
                    name="os"
                    defaultValue={initial.os}
                    placeholder="Windows Server 2022"
                  />
                </Field>
                <Field label="Version" name="version" error={err.version}>
                  <Input id="version" name="version" defaultValue={initial.version} />
                </Field>
              </div>
              <Field
                label="IP addresses"
                name="ipAddresses"
                hint="Comma or space separated. IPv4 or IPv6."
                error={err.ipAddresses}
              >
                <Input
                  id="ipAddresses"
                  name="ipAddresses"
                  defaultValue={initial.ipAddresses}
                  placeholder="10.0.0.23"
                  className="font-mono"
                  aria-invalid={!!err.ipAddresses}
                />
              </Field>
            </Section>

            <Section title="Context">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Owner" name="owner" hint="Person or team" error={err.owner}>
                  <Input
                    id="owner"
                    name="owner"
                    defaultValue={initial.owner}
                    maxLength={120}
                    placeholder="Platform team"
                  />
                </Field>
                <Field label="Contact" name="ownerContact" error={err.ownerContact}>
                  <Input
                    id="ownerContact"
                    name="ownerContact"
                    defaultValue={initial.ownerContact}
                    maxLength={200}
                    placeholder="platform@example.com"
                  />
                </Field>
              </div>
              <Field label="Description" name="description" error={err.description}>
                <Input
                  id="description"
                  name="description"
                  defaultValue={initial.description}
                  maxLength={500}
                  placeholder="What is it for?"
                />
              </Field>
              <Field
                label="Tags"
                name="tags"
                hint="Comma separated, e.g. iis, customer-portal"
                error={err.tags}
              >
                <Input
                  id="tags"
                  name="tags"
                  defaultValue={initial.tags}
                  aria-invalid={!!err.tags}
                />
              </Field>
              <Field
                label="Links"
                name="links"
                hint="One per line: Label https://…  (https only)"
                error={err.links}
              >
                <Textarea
                  id="links"
                  name="links"
                  defaultValue={initial.links}
                  rows={3}
                  className="font-mono text-xs"
                  aria-invalid={!!err.links}
                />
              </Field>
              <Field label="Notes" name="notes" error={err.notes}>
                <Textarea id="notes" name="notes" defaultValue={initial.notes} rows={5} />
              </Field>
            </Section>
          </div>

          {state.duplicates && state.duplicates.length > 0 && (
            <div
              role="alert"
              className="border-warning/40 bg-surface-2 mx-5 mb-3 rounded-md border px-3 py-2.5 text-xs"
            >
              <p className="text-warning font-medium">
                {state.duplicates.length === 1
                  ? "A resource with this name already exists:"
                  : "Resources with this name already exist:"}
              </p>
              <ul className="mt-1 space-y-0.5">
                {state.duplicates.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/w/${workspaceSlug}/resources/${d.id}`}
                      target="_blank"
                      className="font-mono hover:underline"
                    >
                      {d.name}
                    </Link>
                    {d.status === "ARCHIVED" && <span className="text-subtle"> (archived)</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={saveAnyway}>
                  {mode === "create" ? "Create anyway" : "Save anyway"}
                </Button>
                <span className="text-muted">or change the name.</span>
              </div>
            </div>
          )}
          <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
            <p role="alert" className="text-danger min-w-0 text-xs leading-snug">
              {state.error ??
                (Object.values(err).some(Boolean) ? "Fix the highlighted fields." : "")}
            </p>
            <div className="flex shrink-0 gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : mode === "create" ? "Create resource" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-subtle mb-3 text-[11px] font-medium tracking-wider uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? (
        <p className="text-danger text-[11px]">{error}</p>
      ) : (
        hint && <p className="text-subtle text-[11px]">{hint}</p>
      )}
    </div>
  );
}
