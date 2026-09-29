// SPDX-License-Identifier: AGPL-3.0-only
/** Relationship validation — pure (safe for client imports and unit tests). */
import { z } from "zod";
import { RelationshipType } from "@/generated/prisma/enums";

export const NOTE_MAX = 1000;
const id = z.string().min(1, "Choose a resource").max(64);
const note = z
  .string()
  .trim()
  .max(NOTE_MAX)
  .nullable()
  .default(null)
  .transform((v) => (v === "" ? null : v));

export const relationshipCreateSchema = z
  .object({
    fromResourceId: id,
    toResourceId: id,
    type: z.enum(RelationshipType, { error: "Choose a relationship type" }),
    note,
  })
  .refine((v) => v.fromResourceId !== v.toResourceId, {
    message: "A resource cannot have a relationship with itself",
    path: ["otherResourceId"],
  });
export type RelationshipCreateInput = z.infer<typeof relationshipCreateSchema>;

export const relationshipUpdateSchema = z.object({
  type: z.enum(RelationshipType, { error: "Choose a relationship type" }),
  note,
});
export type RelationshipUpdateInput = z.infer<typeof relationshipUpdateSchema>;

/**
 * The form is filled from one resource's page: it picks the other resource and
 * whether the edge goes out of ("outgoing") or into ("incoming") this resource.
 */
export function relationshipFormToCreateInput(form: FormData, viewerId: string): unknown {
  const other = String(form.get("otherResourceId") ?? "");
  const incoming = form.get("direction") === "incoming";
  return {
    fromResourceId: incoming ? other : viewerId,
    toResourceId: incoming ? viewerId : other,
    type: String(form.get("type") ?? ""),
    note: String(form.get("note") ?? ""),
  };
}

export function relationshipFormToUpdateInput(form: FormData): unknown {
  return { type: String(form.get("type") ?? ""), note: String(form.get("note") ?? "") };
}

export function relationshipFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    const field = key === "fromResourceId" || key === "toResourceId" ? "otherResourceId" : key;
    out[field] ??= issue.message;
  }
  return out;
}
