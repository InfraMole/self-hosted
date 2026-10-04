// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { CopyBlock } from "@/components/agents/create-token-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import type { SavedViewSummary } from "@/lib/map-view-state";

export type ShareResult =
  { ok: true; url: string; expiresAt: string | null } | { ok: false; error: string };

const EXPIRY = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "Never" },
];

/** Public read-only link to a saved view (M31): what it shows, then the URL once. */
export function ShareViewDialog({
  view,
  share,
  onClose,
}: {
  view: SavedViewSummary;
  share: (expiresInDays: number) => Promise<ShareResult>;
  onClose: () => void;
}) {
  const [days, setDays] = useState("30");
  const [result, setResult] = useState<ShareResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Public link to “{view.name}”</DialogTitle>
        {result?.ok ? (
          <>
            <DialogDescription>
              Copy the link now — it will not be shown again. Anyone with it can open this view
              until it {result.expiresAt ? "expires or " : ""}is revoked in Settings.
            </DialogDescription>
            <div className="mt-4">
              <CopyBlock label="Link" value={result.url} />
            </div>
            <div className="mt-5 flex justify-end">
              <DialogClose asChild>
                <Button variant="secondary">Done</Button>
              </DialogClose>
            </div>
          </>
        ) : (
          <>
            <DialogDescription>
              Anyone with the link sees this view without an account: resource names, types,
              environments and how they are linked, as they are now. IP addresses, owners, notes and
              anything outside the view are never shown.
            </DialogDescription>
            <label className="mt-4 flex flex-col gap-1.5 text-xs">
              Expires in
              <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-40">
                {EXPIRY.map((e) => (
                  <option key={e.days} value={e.days}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </label>
            {result && !result.ok && (
              <p role="alert" className="text-danger mt-3 text-xs">
                {result.error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                disabled={pending}
                onClick={() => startTransition(async () => setResult(await share(Number(days))))}
              >
                {pending ? "Creating…" : "Create link"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
