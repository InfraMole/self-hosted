// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resource validation — pure (no DB / Next imports) so it is unit tested and
 * safe to import from client components. Field semantics: docs/DATA_MODEL.md §3.
 */
import { z } from "zod";
import { Criticality, Environment, ResourceStatus, ResourceType } from "@/generated/prisma/enums";

export const LIMITS = {
  name: 128,
  description: 500,
  notes: 10_000,
  tags: 20,
  tag: 32,
  links: 20,
  linkLabel: 64,
  url: 2048,
  ipAddresses: 32,
  hostname: 253,
  os: 128,
  version: 64,
} as const;

const TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(LIMITS.tag, `Tags are at most ${LIMITS.tag} characters`)
  .regex(TAG_PATTERN, "Tags use a-z, 0-9 and . _ : -");

export const resourceLinkSchema = z.object({
  label: z.string().trim().min(1).max(LIMITS.linkLabel),
  url: z.url({ protocol: /^https$/, error: "Links must be https:// URLs" }).max(LIMITS.url),
});
export type ResourceLink = z.infer<typeof resourceLinkSchema>;

/** Allow-listed metadata keys only (.strict): no free-form secrets bucket. */
export const resourceMetadataSchema = z
  .object({
    hostname: z.string().trim().min(1).max(LIMITS.hostname).optional(),
    fqdn: z.string().trim().min(1).max(LIMITS.hostname).optional(),
    os: z.string().trim().min(1).max(LIMITS.os).optional(),
    version: z.string().trim().min(1).max(LIMITS.version).optional(),
    ipAddresses: z
      .array(z.union([z.ipv4(), z.ipv6()], { error: "Invalid IP address" }))
      .max(LIMITS.ipAddresses)
      .optional(),
  })
  .strict();
export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;

/** Statuses a human may set. DISCOVERED / STALE are set by discovery only. */
export const MANUAL_STATUSES = [ResourceStatus.ACTIVE, ResourceStatus.ARCHIVED] as const;

export const resourceInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(LIMITS.name),
  type: z.enum(ResourceType, { error: "Choose a type" }),
  environment: z.enum(Environment).nullable().default(null),
  criticality: z.enum(Criticality).nullable().default(null),
  status: z.enum(MANUAL_STATUSES).default(ResourceStatus.ACTIVE),
  description: z.string().trim().max(LIMITS.description).nullable().default(null),
  notes: z.string().max(LIMITS.notes).nullable().default(null),
  tags: z
    .array(tagSchema)
    .max(LIMITS.tags, `At most ${LIMITS.tags} tags`)
    .default([])
    .transform((tags) => [...new Set(tags)]),
  links: z.array(resourceLinkSchema).max(LIMITS.links).default([]),
  metadata: resourceMetadataSchema.default({}),
});
export type ResourceInput = z.infer<typeof resourceInputSchema>;

/** Library filters from URL search params. Invalid values are dropped, not errors. */
export const resourceFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(ResourceType).optional().catch(undefined),
  environment: z.enum(Environment).optional().catch(undefined),
  status: z.enum(ResourceStatus).optional().catch(undefined),
  /** Provenance (ADR-021): a sourceRef, or "manual" for resources created by people. */
  source: z.string().max(200).optional().catch(undefined),
});
export type ResourceFilters = z.infer<typeof resourceFiltersSchema>;

// ───────────────────────── Form parsing ─────────────────────────

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function list(value: string | null): string[] {
  return value ? value.split(/[\s,]+/).filter(Boolean) : [];
}

/** "Label https://url" or "https://url" per line. */
export function parseLinks(value: string | null): { label: string; url: string }[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const url = parts.pop()!;
      const label = parts.join(" ") || safeHostname(url) || url;
      return { label, url };
    });
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function formatLinks(links: ResourceLink[]): string {
  return links.map((l) => `${l.label} ${l.url}`).join("\n");
}

/** Converts the resource form into an object for resourceInputSchema. */
export function resourceFormToInput(form: FormData): unknown {
  const metadata: Record<string, unknown> = {};
  for (const key of ["hostname", "fqdn", "os", "version"] as const) {
    const value = text(form, key);
    if (value) metadata[key] = value;
  }
  const ips = list(text(form, "ipAddresses"));
  if (ips.length) metadata.ipAddresses = ips;

  return {
    name: text(form, "name") ?? "",
    type: text(form, "type") ?? "",
    environment: text(form, "environment"),
    criticality: text(form, "criticality"),
    status: text(form, "status") ?? undefined,
    description: text(form, "description"),
    notes: text(form, "notes"),
    tags: list(text(form, "tags")),
    links: parseLinks(text(form, "links")),
    metadata,
  };
}

/** First error message per form field (metadata.* fields map to their input name). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, second] = issue.path;
    const key = String(first === "metadata" && second !== undefined ? second : (first ?? "form"));
    out[key] ??= issue.message;
  }
  return out;
}
