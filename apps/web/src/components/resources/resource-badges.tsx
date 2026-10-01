// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Criticality,
  Environment,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { CRITICALITIES, ENVIRONMENTS, RESOURCE_TYPES, STATUSES } from "@/lib/resource-presentation";
import { TECHS, type ResourceTech, type TechKey } from "@/lib/tech";
import { TECH_LOGOS } from "@/lib/tech-logos";
import { cn } from "@/lib/utils";

/**
 * A technology: its single-colour logo when Simple Icons publishes one, else a
 * neutral text monogram (ADR-038). `small`: the "where it runs" companion.
 */
export function TechChip({ tech, small }: { tech: TechKey; small?: boolean }) {
  const t = TECHS[tech];
  const logo = TECH_LOGOS[tech];
  if (logo)
    return (
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label={t.label}
        className={cn(
          "shrink-0 fill-current",
          small ? "text-subtle size-3" : "text-foreground/85 size-4",
        )}
      >
        <title>{t.label}</title>
        <path d={logo} />
      </svg>
    );
  return (
    <span
      title={t.label}
      aria-label={t.label}
      className={cn(
        "border-border-strong inline-flex shrink-0 items-center justify-center rounded-sm border font-mono leading-none font-semibold tracking-tight",
        small ? "text-subtle h-3.5 px-0.5 text-[8px]" : "text-muted h-4 min-w-4 px-0.5 text-[9px]",
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
