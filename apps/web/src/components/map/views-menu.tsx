// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, Check, ChevronDown, Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SavedViewState, SavedViewSummary, ViewActionResult } from "@/lib/map-view-state";
import { cn } from "@/lib/utils";

interface Props {
  views: SavedViewSummary[];
  activeId: string | null;
  /** The active view differs from what is on screen. */
  modified: boolean;
  canEdit: boolean;
  current: () => SavedViewState;
  onApply: (view: SavedViewSummary | null) => void;
  /** After a save: the id of the view now active. */
  onSaved: (id: string) => void;
  onSave: (input: {
    id?: string;
    name: string;
    state: SavedViewState;
  }) => Promise<ViewActionResult>;
  onDelete: (id: string) => Promise<ViewActionResult>;
  /** Admins: open the public-link dialog for a view (M31). */
  onShare?: (view: SavedViewSummary) => void;
}

/** Saved map views (M26 phase 3, ADR-041): shared with the workspace. */
export function ViewsMenu({
  views,
  activeId,
  modified,
  canEdit,
  current,
  onApply,
  onSaved,
  onSave,
  onDelete,
  onShare,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const active = views.find((v) => v.id === activeId) ?? null;

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (action: () => Promise<ViewActionResult>, after?: (id?: string) => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error);
      else after?.(result.id);
    });

  return (
    <div ref={panel} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="border-border bg-surface/95 text-muted hover:text-foreground inline-flex h-8 max-w-56 items-center gap-1.5 rounded-lg border px-2 text-xs backdrop-blur"
        title="Saved views: filters, open boxes and positions, shared with the workspace"
      >
        <Bookmark className="size-3.5 shrink-0" />
        <span className="truncate">{active ? active.name : "Views"}</span>
        {active && modified && <span className="text-warning shrink-0">· modified</span>}
        <ChevronDown className="size-3 shrink-0" />
      </button>
      {open && (
        <div className="border-border bg-surface absolute top-full right-0 z-20 mt-1 w-72 rounded-lg border p-2 shadow-lg">
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => {
                  onApply(null);
                  setOpen(false);
                }}
                className="hover:bg-surface-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
              >
                <Check className={cn("size-3.5", activeId ? "invisible" : "text-accent")} />
                <span className="text-muted">Whole map (automatic layout)</span>
              </button>
            </li>
            {views.map((v) => (
              <li key={v.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    onApply(v);
                    setOpen(false);
                  }}
                  className="hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      v.id === activeId ? "text-accent" : "invisible",
                    )}
                  />
                  <span className="truncate">{v.name}</span>
                </button>
                {onShare && (
                  <button
                    type="button"
                    aria-label={`Public link to ${v.name}`}
                    title="Public read-only link"
                    onClick={() => {
                      onShare(v);
                      setOpen(false);
                    }}
                    className="text-subtle hover:text-accent rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Link2 className="size-3.5" />
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Delete view ${v.name}`}
                    onClick={() => {
                      if (!window.confirm(`Delete the view "${v.name}" for everyone?`)) return;
                      run(
                        () => onDelete(v.id),
                        () => v.id === activeId && onApply(null),
                      );
                    }}
                    className="text-subtle hover:text-danger rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {views.length === 0 && (
            <p className="text-subtle px-2 py-1 text-xs">No saved views yet.</p>
          )}

          {canEdit ? (
            <div className="border-border mt-2 space-y-2 border-t pt-2">
              {active && modified && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={pending}
                  onClick={() =>
                    run(() => onSave({ id: active.id, name: active.name, state: current() }))
                  }
                >
                  Save changes to “{active.name}”
                </Button>
              )}
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    () => onSave({ name, state: current() }),
                    (id) => {
                      setName("");
                      if (id) onSaved(id);
                    },
                  );
                }}
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Save this view as…"
                  aria-label="New view name"
                  maxLength={80}
                  className="h-8 text-xs"
                />
                <Button size="sm" type="submit" disabled={pending || !name.trim()}>
                  Save
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-subtle border-border mt-2 border-t px-2 pt-2 text-xs">
              Members can save views for everyone in the workspace.
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger px-2 pt-2 text-xs">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
