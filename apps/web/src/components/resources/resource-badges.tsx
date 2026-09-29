// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Criticality,
  Environment,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { CRITICALITIES, ENVIRONMENTS, RESOURCE_TYPES, STATUSES } from "@/lib/resource-presentation";
import { cn } from "@/lib/utils";

export function TypeIcon({ type, className }: { type: ResourceType; className?: string }) {
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
