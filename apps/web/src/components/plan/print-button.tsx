// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The browser's print dialog: print the report, or "Save as PDF" (vector, selectable text). */
export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}
