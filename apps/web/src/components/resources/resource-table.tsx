// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState, useTransition } from "react";
import type {
  Criticality,
  Environment,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";
import {
  CriticalityLabel,
  EnvironmentLabel,
  StatusBadge,
  TypeIcon,
} from "@/components/resources/resource-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, formatRelative } from "@/lib/format";
import { RESOURCE_TYPES } from "@/lib/resource-presentation";
import type { ResourceTech } from "@/lib/tech";
import { cn } from "@/lib/utils";

export interface ResourceRow {
  id: string;
  name: string;
  type: ResourceType;
  environment: Environment | null;
  criticality: Criticality | null;
  status: ResourceStatus;
  ips: string[];
  updatedAt: Date;
  sourceLabel: string | null;
  owner?: string | null;
  tech?: ResourceTech;
}

/** Server-side sort of the Library (M31): the column and direction in the URL. */
export interface TableSort {
  sort: string;
  dir: "asc" | "desc";
  /** Direction a column starts with when it is clicked. */
  defaults: Record<string, "asc" | "desc">;
}

type Action = (ids: string[]) => Promise<{ error?: string; message?: string }>;
type OwnerAction = (
  ids: string[],
  input: { owner: string; ownerContact: string },
) => Promise<{ error?: string; message?: string }>;

/** Library table; with `canWrite`, rows can be selected for bulk archive / delete. */
export function ResourceTable({
  slug,
  rows,
  canWrite,
  archiveAction,
  deleteAction,
  ownerAction,
  sort,
}: {
  slug: string;
  rows: ResourceRow[];
  canWrite: boolean;
  archiveAction: Action;
  deleteAction: Action;
  ownerAction: OwnerAction;
  sort?: TableSort;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [owning, setOwning] = useState(false);
  const [owner, setOwner] = useState({ owner: "", ownerContact: "" });
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const all = rows.length > 0 && selected.size === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (action: Action) =>
    startTransition(async () => {
      const result = await action([...selected]);
      setFeedback(result);
      if (!result.error) {
        setSelected(new Set());
        setConfirmDelete(false);
        setOwning(false);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-2">
      {canWrite && (selected.size > 0 || feedback.message || feedback.error) && (
        <div className="border-border bg-surface flex items-center gap-3 rounded-md border px-3 py-1.5 text-xs">
          {selected.size > 0 ? (
            <>
              <span className="font-medium">{selected.size} selected</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => run(archiveAction)}
              >
                Archive
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => setOwning(true)}
              >
                Set owner…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                Delete…
              </Button>
              <button
                type="button"
                className="text-subtle hover:text-foreground ml-auto"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            </>
          ) : (
            <span role="status" className={feedback.error ? "text-danger" : "text-muted"}>
              {feedback.error ?? feedback.message}
            </span>
          )}
        </div>
      )}
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-surface text-subtle border-b text-left text-[11px] tracking-wider uppercase">
              {canWrite && (
                <th className="w-8 pl-3">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={all}
                    onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                    className="accent-[var(--accent)]"
                  />
                </th>
              )}
              <SortHeader column="name" label="Name" sort={sort} />
              <SortHeader column="type" label="Type" sort={sort} />
              <SortHeader column="environment" label="Environment" sort={sort} />
              <SortHeader column="criticality" label="Criticality" sort={sort} />
              <th className="px-3 py-2 font-medium">IP addresses</th>
              <SortHeader column="owner" label="Owner" sort={sort} />
              <SortHeader column="status" label="Status" sort={sort} />
              <SortHeader column="updated" label="Updated" sort={sort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={selected.has(r.id) ? "bg-surface-2" : "group hover:bg-surface-2/60"}
              >
                {canWrite && (
                  <td className="w-8 pl-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="accent-[var(--accent)]"
                    />
                  </td>
                )}
                <td className="px-3 py-0">
                  <Link
                    href={`/w/${slug}/resources/${r.id}`}
                    className="group-hover:text-foreground flex h-10 items-center gap-2.5 font-mono text-[13px]"
                    title={r.sourceLabel ? `Created by ${r.sourceLabel}` : undefined}
                  >
                    <span className="flex w-11 shrink-0 items-center">
                      <TypeIcon type={r.type} tech={r.tech} />
                    </span>
                    <span className="truncate">{r.name}</span>
                  </Link>
                </td>
                <td className="text-muted px-3 whitespace-nowrap">
                  {RESOURCE_TYPES[r.type].label}
                </td>
                <td className="text-muted px-3 whitespace-nowrap">
                  <EnvironmentLabel environment={r.environment} />
                </td>
                <td className="px-3 whitespace-nowrap">
                  <CriticalityLabel criticality={r.criticality} />
                </td>
                <td className="text-muted max-w-56 truncate px-3 font-mono text-xs">
                  {r.ips.join(", ") || <span className="text-subtle">—</span>}
                </td>
                <td
                  className="text-muted max-w-40 truncate px-3 text-xs"
                  title={r.owner ?? undefined}
                >
                  {r.owner || <span className="text-subtle">—</span>}
                </td>
                <td className="px-3">
                  <StatusBadge status={r.status} />
                </td>
                <td
                  className="text-subtle px-3 text-right text-xs whitespace-nowrap"
                  title={formatDateTime(r.updatedAt)}
                >
                  {formatRelative(r.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={owning} onOpenChange={setOwning}>
        <DialogContent>
          <DialogTitle>Set the owner of {selected.size} resources</DialogTitle>
          <DialogDescription>
            Who to warn when they could be affected. Leave the owner empty to clear it.
          </DialogDescription>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs">
              Owner
              <Input
                value={owner.owner}
                onChange={(e) => setOwner({ ...owner, owner: e.target.value })}
                maxLength={120}
                placeholder="Platform team"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs">
              Contact
              <Input
                value={owner.ownerContact}
                onChange={(e) => setOwner({ ...owner, ownerContact: e.target.value })}
                maxLength={200}
                placeholder="platform@example.com"
              />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOwning(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => run((ids) => ownerAction(ids, owner))}>
              {pending ? "Saving…" : owner.owner.trim() ? "Set owner" : "Clear owner"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle>Delete {selected.size} resources?</DialogTitle>
          <DialogDescription>
            Their relationships are deleted too and this cannot be undone. Archive instead if you
            may need their history, notes or relationships later.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button variant="secondary" disabled={pending} onClick={() => run(archiveAction)}>
              Archive instead
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(deleteAction)}>
              {pending ? "Deleting…" : `Delete ${selected.size}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A column header that sorts the Library through the URL (first page, server-side). */
function SortHeader({
  column,
  label,
  sort,
  align,
}: {
  column: string;
  label: string;
  sort?: TableSort;
  align?: "right";
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  if (!sort)
    return (
      <th className={cn("px-3 py-2 font-medium", align === "right" && "text-right")}>{label}</th>
    );
  const active = sort.sort === column;
  const dir = active ? (sort.dir === "asc" ? "desc" : "asc") : (sort.defaults[column] ?? "asc");
  const next = new URLSearchParams(params.toString());
  next.set("sort", column);
  next.set("dir", dir);
  next.delete("page");
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn("px-3 py-2 font-medium", align === "right" && "text-right")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <Link
        href={`${pathname}?${next.toString()}`}
        scroll={false}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1",
          active && "text-foreground",
        )}
      >
        {label}
        {active && <Arrow className="size-3" aria-hidden />}
      </Link>
    </th>
  );
}
