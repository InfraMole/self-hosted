// SPDX-License-Identifier: AGPL-3.0-only
/** Labels, icons and colours for resource enums — one place, used by every screen (docs/UI.md §2). */
import {
  AppWindow,
  Cloud,
  Cog,
  Container,
  Database,
  Globe,
  HardDrive,
  Network,
  Plug,
  Server,
  Shapes,
  SquareStack,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type {
  Criticality,
  Environment,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";

export const RESOURCE_TYPES: Record<ResourceType, { label: string; icon: LucideIcon }> = {
  SERVER: { label: "Server", icon: Server },
  VM: { label: "VM", icon: SquareStack },
  APPLICATION: { label: "Application", icon: AppWindow },
  WINDOWS_SERVICE: { label: "Windows service", icon: Cog },
  LINUX_SERVICE: { label: "Linux service", icon: Terminal },
  DATABASE: { label: "Database", icon: Database },
  DOMAIN: { label: "Domain", icon: Globe },
  API: { label: "API", icon: Plug },
  STORAGE: { label: "Storage", icon: HardDrive },
  NETWORK: { label: "Network", icon: Network },
  CONTAINER: { label: "Container", icon: Container },
  EXTERNAL_SERVICE: { label: "External service", icon: Cloud },
  OTHER: { label: "Other", icon: Shapes },
};

export const ENVIRONMENTS: Record<Environment, { label: string; dot: string }> = {
  PRODUCTION: { label: "Production", dot: "bg-danger" },
  STAGING: { label: "Staging", dot: "bg-warning" },
  DEVELOPMENT: { label: "Development", dot: "bg-info" },
  TEST: { label: "Test", dot: "bg-violet" },
  OTHER: { label: "Other", dot: "bg-subtle" },
};

export const CRITICALITIES: Record<Criticality, { label: string; text: string }> = {
  CRITICAL: { label: "Critical", text: "text-danger" },
  HIGH: { label: "High", text: "text-warning" },
  MEDIUM: { label: "Medium", text: "text-foreground" },
  LOW: { label: "Low", text: "text-muted" },
};

export const STATUSES: Record<ResourceStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "border-border-strong text-muted" },
  DISCOVERED: { label: "Discovered", className: "border-accent/50 text-accent" },
  STALE: { label: "Stale", className: "border-warning/50 text-warning" },
  ARCHIVED: { label: "Archived", className: "border-border text-subtle" },
};

export function entries<K extends string, V>(record: Record<K, V>): [K, V][] {
  return Object.entries(record) as [K, V][];
}
