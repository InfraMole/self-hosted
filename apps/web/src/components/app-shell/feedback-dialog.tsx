// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Kind = "problem" | "idea" | "other";
const KINDS: { value: Kind; label: string }[] = [
  { value: "problem", label: "Something’s wrong" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

export type FeedbackAction = (input: {
  kind: Kind;
  message: string;
  page?: string;
}) => Promise<{ ok?: true; error?: string }>;

/** Sidebar "Feedback" (M12): emailed to the team, nothing stored, no third-party widget. */
export function FeedbackDialog({ action }: { action: FeedbackAction }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSent(false);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className="text-muted hover:bg-surface-2/60 hover:text-foreground flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm transition-colors [&_svg]:size-4">
          <MessageSquare /> Feedback
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          Goes straight to the InfraMole team by email; we reply to your address. Please don’t
          include passwords or secrets.
        </DialogDescription>
        {sent ? (
          <div className="mt-4 space-y-4">
            <p role="status" className="text-success text-sm">
              Thanks — sent. We read every message.
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await action({ kind, message, page: pathname });
                if (r.error) setError(r.error);
                else {
                  setSent(true);
                  setMessage("");
                }
              });
            }}
          >
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    kind === k.value
                      ? "border-accent/60 bg-accent/10 text-foreground"
                      : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea
                id="feedback-message"
                rows={6}
                maxLength={4000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What were you trying to do, and what happened?"
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-danger text-xs">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || message.trim().length < 3}>
                {pending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
