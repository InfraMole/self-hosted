// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />;
}

/** Centered dialog (confirmations). */
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "border-border-strong bg-surface fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-2xl shadow-black/40",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Right-side sheet (create/edit forms — docs/UI.md: side sheet, not a modal wizard). */
export function SheetContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "border-border-strong bg-surface fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l shadow-2xl shadow-black/40",
          className,
        )}
        {...props}
      >
        <div className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-sm font-medium">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted truncate text-xs">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="text-subtle hover:bg-surface-2 hover:text-foreground rounded p-1"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("text-sm font-medium", className)} {...props} />
);

export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("text-muted mt-1 text-sm", className)} {...props} />
);
