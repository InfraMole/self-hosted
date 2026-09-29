// SPDX-License-Identifier: AGPL-3.0-only
import Image from "next/image";
import { cn } from "@/lib/utils";

/** App mark: the mole on its lavender tile (ADR-022). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/inframole-mark.png"
      alt=""
      width={96}
      height={96}
      className={cn("size-5 rounded-[5px]", className)}
    />
  );
}

/** Wordmark: always "InfraMole" — Infra in the text colour, Mole in brand violet. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      Infra<span className="text-brand-violet">Mole</span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <Wordmark />
    </span>
  );
}

/** The full mascot (transparent PNG, 800×560). Brand moments only: landing, auth, 404. */
export function Mascot({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/inframole-mascot.png"
      alt="InfraMole, a mole wearing violet goggles"
      width={800}
      height={560}
      priority={priority}
      className={className}
    />
  );
}
