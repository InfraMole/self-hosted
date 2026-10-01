// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Criticality,
  Environment,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { CRITICALITIES, ENVIRONMENTS, RESOURCE_TYPES, STATUSES } from "@/lib/resource-presentation";
import { TECHS, type ResourceTech, type TechCategory, type TechKey } from "@/lib/tech";
import { cn } from "@/lib/utils";

const CATEGORY_CHIP: Record<TechCategory, string> = {
  database: "bg-info/20 text-info ring-info/40",
  web: "bg-accent/20 text-accent ring-accent/40",
  app: "bg-success/20 text-success ring-success/40",
  platform: "bg-violet/20 text-violet ring-violet/40",
  cloud: "bg-warning/20 text-warning ring-warning/40",
  os: "bg-surface-2 text-muted ring-border-strong",
};

/** A technology as a text monogram in our colours (never a third-party logo, ADR-037). */
export function TechChip({ tech, small }: { tech: TechKey; small?: boolean }) {
  const t = TECHS[tech];
  return (
    <span
      title={t.label}
      aria-label={t.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded font-mono leading-none font-bold tracking-tight ring-1 ring-inset",
        small ? "h-4 min-w-6 px-1 text-[9px] opacity-75" : "h-[18px] min-w-7 px-1 text-[10px]",
        CATEGORY_CHIP[t.category],
      )}
    >
      {t.mono}
    </span>
  );
}

/** "PostgreSQL · on Docker" next to a resource's name (nothing when unknown). */
export function TechLabel({ tech }: { tech: ResourceTech }) {
  if (!tech.primary) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <TechChip tech={tech.primary} />
      <span>{TECHS[tech.primary].label}</span>
      {tech.platform && (
        <>
          <span className="text-subtle">on</span>
          <TechChip tech={tech.platform} small />
          <span>{TECHS[tech.platform].label}</span>
        </>
      )}
    </span>
  );
}

/**
 * The resource's technology when known (what it is + where it runs), else
 * the generic icon of its type.
 */
export function TypeIcon({
  type,
  tech,
  className,
}: {
  type: ResourceType;
  tech?: ResourceTech;
  className?: string;
}) {
  // A domain is not "running on" the platform that reported it (Kubernetes, Docker…).
  const shown =
    type === "DOMAIN" && tech?.primary && TECHS[tech.primary].category === "platform"
      ? undefined
      : tech;
  if (shown?.primary)
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5"
        title={RESOURCE_TYPES[type].label}
      >
        <TechChip tech={shown.primary} />
        {shown.platform && <TechChip tech={shown.platform} small />}
      </span>
    );
  const Icon = RESOURCE_TYPES[type].icon;
  return <Icon aria-hidden className={cn("text-muted size-4 shrink-0", className)} />;
}

export function EnvironmentLabel({ environment }: { environment: Environment | null }) {
  if (!environment) return <span className="text-subtle">—</span>;
  const env = ENVIRONMENTS[environment];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", env.dot)} aria-hidden />
      {env.label}
    </span>
  );
}

export function CriticalityLabel({ criticality }: { criticality: Criticality | null }) {
  if (!criticality) return <span className="text-subtle">—</span>;
  const c = CRITICALITIES[criticality];
  return <span className={c.text}>{c.label}</span>;
}

export function StatusBadge({ status }: { status: ResourceStatus }) {
  const s = STATUSES[status];
  return <Badge className={s.className}>{s.label}</Badge>;
}
