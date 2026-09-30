// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { isBillable } from "@/lib/billing-plans";
import {
  PlanLimitError,
  assertCanAddNodes,
  assertDiscoveryActive,
  getUsage,
} from "@/server/modules/billing/limits";
import { z } from "zod";
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
import type { Prisma } from "@/generated/prisma/client";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { refreshDetectedRelationships } from "@/server/modules/discovery/discovery";
import { diffResource, type ResourceSnapshot } from "@/server/modules/resources/diff";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";
import { IMPORT_LIMITS, detectFormat, parseImport, type ImportFormat } from "./parse";
import { planImport, type ExistingResource, type ImportPlan } from "./plan";

export const importRequestSchema = z.object({
  text: z.string().min(1, "Paste or upload something to import.").max(IMPORT_LIMITS.bytes),
  format: z
    .enum([
      "auto",
      "csv",
      "json",
      "docker-compose",
      "proxmox",
      "azure",
      "aws",
      "cloudflare",
      "workloads",
      "cloud",
    ])
    .default("auto"),
  project: z.string().trim().max(64).optional(),
  /** CSV/JSON relationships become suggestions instead of confirmed facts. */
  relationshipsAsSuggestions: z.boolean().default(false),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

export class ImportHasErrorsError extends Error {
  constructor(count: number) {
    super(`The import has ${count} error(s); nothing was imported. Fix them and preview again.`);
    this.name = "ImportHasErrorsError";
  }
}

async function buildPlan(
  ctx: Pick<WorkspaceContext, "workspaceId">,
  raw: ImportRequest,
): Promise<{ plan: ImportPlan; request: z.output<typeof importRequestSchema> }> {
  const request = importRequestSchema.parse(raw);
  const format: ImportFormat =
    request.format === "auto" ? detectFormat(request.text) : request.format;
  const batch = parseImport(request.text, format, { project: request.project });
  const db = tenantDb(ctx);
  const [resources, relationships] = await Promise.all([
    db.resource.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: {
        id: true,
        name: true,
        type: true,
        source: true,
        externalId: true,
        environment: true,
        criticality: true,
        description: true,
        notes: true,
        tags: true,
        metadata: true,
      },
    }),
    db.relationship.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { fromResourceId: true, toResourceId: true, type: true },
    }),
  ]);
  const existing: ExistingResource[] = resources.map((r) => {
    const meta = resourceMetadataSchema.safeParse(r.metadata);
    return { ...r, metadata: meta.success ? meta.data : {} };
  });
  const plan = planImport(
    batch,
    existing,
    relationships.map((r) => ({ from: r.fromResourceId, to: r.toResourceId, type: r.type })),
  );
  return { plan, request };
}

/** Dry run: what would happen. MEMBER+ (only writers can import). */
export async function previewImport(
  ctx: WorkspaceContext,
  raw: ImportRequest,
): Promise<ImportPlan> {
  assertRole(ctx, "MEMBER");
  const { plan } = await buildPlan(ctx, raw);
  const adding = billableCreates(plan);
  if (adding > 0) {
    const usage = await getUsage(ctx.workspaceId);
    if (usage.limit !== null && usage.nodes + adding > usage.limit)
      plan.warnings.push(new PlanLimitError(usage, adding).message);
  }
  return plan;
}

/** Servers/VMs this plan would create (plan limit, ADR-019). */
function billableCreates(plan: ImportPlan): number {
  return plan.resources.filter((r) => r.action === "create" && isBillable({ type: r.type })).length;
}

export interface ImportResult {
  format: ImportFormat;
  created: number;
  updated: number;
  unchanged: number;
  relationships: number;
  suggestions: number;
  /** Reconciliation (ADR-021): owned resources no longer reported / reported again. */
  staled: number;
  restored: number;
  /** Set when reconciliation was skipped by the partial-response guard. */
  reconcileSkipped?: string;
}

/** Where resources come from (ADR-021). Reconcile only for full snapshots (integrations, collectors). */
export interface ImportSource {
  ref: string;
  label: string;
  reconcile: boolean;
}

/** Reconciliation would stale more than this share of a source's resources → skip (partial response?). */
const RECONCILE_MAX_SHARE = 0.5;
const RECONCILE_MIN_GUARDED = 5;

/**
 * All-or-nothing: re-plans server-side (never trusts the preview) and refuses
 * when there are errors. Idempotent: re-importing the same input is a no-op.
 */
export async function applyImport(
  ctx: WorkspaceContext,
  raw: ImportRequest,
): Promise<ImportResult> {
  assertRole(ctx, "MEMBER");
  return runImport({ workspaceId: ctx.workspaceId, userId: ctx.userId }, raw);
}

/**
 * The import executor. `userId` is null for unattended runs (scheduled
 * integration sync, agent inventory); `actorId` labels the events (defaults to
 * the format) and `actorType` defaults to IMPORTER (AGENT for agent collectors).
 * Callers are responsible for authorisation.
 */
export async function runImport(
  ctx: { workspaceId: string; userId: string | null },
  raw: ImportRequest,
  options: { actorId?: string; actorType?: "IMPORTER" | "AGENT"; source?: ImportSource } = {},
): Promise<ImportResult> {
  // Imports, integration syncs and agent collectors all pass here (ADR-023).
  await assertDiscoveryActive(ctx.workspaceId);
  const { plan, request } = await buildPlan(ctx, raw);
  if (plan.errors.length > 0) throw new ImportHasErrorsError(plan.errors.length);
  await assertCanAddNodes(ctx.workspaceId, billableCreates(plan));

  const source = plan.format;
  /** Files people write are statements (MANUAL); anything else was reported by a system (DETECTED). */
  const humanAuthored = source === "csv" || source === "json";
  /** Platform inventories arrive as DISCOVERED, like agent hosts. */
  const createStatus =
    source === "proxmox" ||
    source === "azure" ||
    source === "aws" ||
    source === "cloudflare" ||
    source === "workloads" ||
    source === "cloud"
      ? "DISCOVERED"
      : "ACTIVE";
  let suggestions = 0;
  const origin: ImportSource = options.source ?? {
    ref: `file:${source}`,
    label: `${source.toUpperCase()} import`,
    reconcile: false,
  };
  let reconciled: Pick<ImportResult, "staled" | "restored" | "reconcileSkipped"> = {
    staled: 0,
    restored: 0,
  };

  await tenantDb(ctx).$transaction(
    async (tx) => {
      const idByExternal = new Map<string, string>();
      const record = (
        change: Omit<
          Prisma.ChangeEventUncheckedCreateInput,
          "workspaceId" | "actorType" | "actorId"
        >,
      ) =>
        tx.changeEvent.create({
          data: {
            ...change,
            workspaceId: ctx.workspaceId,
            actorType: options.actorType ?? "IMPORTER",
            actorId: options.actorId ?? source,
          },
        });

      for (const r of plan.resources) {
        if (r.action === "create") {
          const created = await tx.resource.create({
            data: {
              ...r.input,
              status: createStatus,
              workspaceId: ctx.workspaceId,
              source: "IMPORT",
              externalId: r.externalId,
              // Provenance (ADR-021): only what a source creates is ever reconciled or retired by it.
              sourceRef: origin.ref,
              sourceLabel: origin.label,
            },
          });
          idByExternal.set(r.externalId, created.id);
          await record({
            subjectType: "RESOURCE",
            subjectId: created.id,
            subjectLabel: created.name,
            kind: "CREATED",
            summary: `Imported ${created.name} (${source})`,
          });
          continue;
        }
        idByExternal.set(r.externalId, r.targetId!);
        if (r.action !== "update") continue;

        const before = await tx.resource.findFirstOrThrow({
          where: { id: r.targetId!, workspaceId: ctx.workspaceId },
        });
        const meta = resourceMetadataSchema.safeParse(before.metadata);
        const metadata: Record<string, unknown> = { ...(meta.success ? meta.data : {}) };
        const data: Prisma.ResourceUpdateInput = {};
        for (const field of r.provided) {
          if (
            field === "hostname" ||
            field === "fqdn" ||
            field === "os" ||
            field === "version" ||
            field === "ipAddresses" ||
            field === "ports"
          ) {
            metadata[field] = r.input.metadata[field];
          } else {
            (data as Record<string, unknown>)[field] = r.input[field];
          }
        }
        data.metadata = metadata as Prisma.InputJsonValue;
        const after = await tx.resource.update({ where: { id: before.id }, data });
        const diff = diffResource(snapshot(before), snapshot(after));
        await record({
          subjectType: "RESOURCE",
          subjectId: after.id,
          subjectLabel: after.name,
          kind: "UPDATED",
          summary: `Updated ${after.name} from ${source}: ${r.changes.join(", ")}`,
          diff: diff as Prisma.InputJsonValue,
        });
      }

      for (const rel of plan.relationships) {
        if (rel.action !== "create") continue;
        const from = rel.from.id ?? idByExternal.get(rel.from.externalId!)!;
        const to = rel.to.id ?? idByExternal.get(rel.to.externalId!)!;
        const asSuggestion = rel.suggested || (humanAuthored && request.relationshipsAsSuggestions);
        const created = await tx.relationship.create({
          data: {
            workspaceId: ctx.workspaceId,
            fromResourceId: from,
            toResourceId: to,
            type: rel.type,
            note: rel.note,
            // ADR-007: MANUAL relationships are always created CONFIRMED.
            origin: humanAuthored && !asSuggestion ? "MANUAL" : "DETECTED",
            ...(asSuggestion
              ? { status: "UNCONFIRMED" as const }
              : {
                  status: "CONFIRMED" as const,
                  confirmedById: ctx.userId,
                  confirmedAt: new Date(),
                }),
          },
        });
        if (asSuggestion) suggestions++;
        await record({
          subjectType: "RELATIONSHIP",
          subjectId: created.id,
          subjectLabel: `${rel.fromLabel} → ${rel.toLabel}`,
          kind: asSuggestion ? "DISCOVERED" : "CREATED",
          summary: `${asSuggestion ? "Suggested" : "Imported"} relationship: ${rel.fromLabel} ${RELATIONSHIP_TYPE_INFO[rel.type].label} ${rel.toLabel} (${source})`,
          resourceIds: [from, to],
        });
      }
      if (origin.reconcile) reconciled = await reconcile(tx, idByExternal, record);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // Imported IPs may resolve agents' unknown endpoints into suggestions.
  await refreshDetectedRelationships(ctx.workspaceId);

  return {
    format: source,
    created: plan.counts.create,
    updated: plan.counts.update,
    unchanged: plan.counts.unchanged,
    relationships: plan.counts.relationships,
    suggestions,
    ...reconciled,
  };

  /**
   * ADR-021: the source's own resources missing from this snapshot become
   * STALE; those reported again return to DISCOVERED. Never deletes. Skipped
   * when it would stale most of the source's resources (partial response?).
   */
  async function reconcile(
    tx: Prisma.TransactionClient,
    idByExternal: Map<string, string>,
    record: (
      c: Omit<Prisma.ChangeEventUncheckedCreateInput, "workspaceId" | "actorType" | "actorId">,
    ) => Promise<unknown>,
  ): Promise<Pick<ImportResult, "staled" | "restored" | "reconcileSkipped">> {
    const seen = new Set(idByExternal.values());
    const owned = await tx.resource.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        sourceRef: origin.ref,
        status: { in: ["ACTIVE", "DISCOVERED", "STALE"] },
      },
      select: { id: true, name: true, status: true },
    });
    const live = owned.filter((r) => r.status !== "STALE");
    const missing = live.filter((r) => !seen.has(r.id));
    const back = owned.filter((r) => r.status === "STALE" && seen.has(r.id));
    const now = new Date();
    await tx.resource.updateMany({
      where: { id: { in: owned.filter((r) => seen.has(r.id)).map((r) => r.id) } },
      data: { lastSeenAt: now },
    });
    for (const r of back) {
      await tx.resource.update({ where: { id: r.id }, data: { status: "DISCOVERED" } });
      await record({
        subjectType: "RESOURCE",
        subjectId: r.id,
        subjectLabel: r.name,
        kind: "UPDATED",
        summary: `${r.name} is reported again by ${origin.label}`,
        diff: { status: ["STALE", "DISCOVERED"] },
      });
    }
    if (
      missing.length >= RECONCILE_MIN_GUARDED &&
      missing.length > live.length * RECONCILE_MAX_SHARE
    )
      return {
        staled: 0,
        restored: back.length,
        reconcileSkipped: `${missing.length} of ${live.length} resources were missing from this sync — not marked stale (partial response?)`,
      };
    for (const r of missing) {
      await tx.resource.update({ where: { id: r.id }, data: { status: "STALE" } });
      await record({
        subjectType: "RESOURCE",
        subjectId: r.id,
        subjectLabel: r.name,
        kind: "NO_LONGER_OBSERVED",
        summary: `${r.name} is no longer reported by ${origin.label}`,
        diff: { status: [r.status, "STALE"] },
      });
    }
    return { staled: missing.length, restored: back.length };
  }
}

function snapshot(r: {
  name: string;
  type: string;
  environment: string | null;
  criticality: string | null;
  status: string;
  description: string | null;
  notes: string | null;
  tags: string[];
  links: unknown;
  metadata: unknown;
}): ResourceSnapshot {
  return {
    name: r.name,
    type: r.type,
    environment: r.environment,
    criticality: r.criticality,
    status: r.status,
    description: r.description,
    notes: r.notes,
    tags: r.tags,
    links: r.links,
    metadata: r.metadata,
  };
}
