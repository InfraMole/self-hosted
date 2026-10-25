// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context): nothing to do.
    }
  }
  return { copied, copy };
}

/** Copies a prepared text (e.g. who to warn before a change) to the clipboard. */
export function CopyTextButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <Button size="sm" variant="outline" onClick={copy}>
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : label}
    </Button>
  );
}

/** The same, as a small icon next to a command (M41). */
export function CopyIconButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className="text-subtle hover:bg-surface-2 hover:text-foreground shrink-0 rounded p-1"
    >
      {copied ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
