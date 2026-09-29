// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type {
  Environment,
  RelationshipOrigin,
  RelationshipStatus,
  RelationshipType,
  ResourceStatus,
  ResourceType,
} from "@/generated/prisma/enums";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { recordUserChange } from "@/server/modules/changes/changes";
import { suggestedTypeForPorts } from "@/server/modules/discovery/protocols";
import { relationshipCreateSchema, relationshipUpdateSchema } from "./schemas";

export class RelationshipNotFoundError extends Error {
  constructor() {
    super("Relationship not found");
    this.name = "RelationshipNotFoundError";
  }
}

export class RelationshipExistsError extends Error {
  constructor() {
    super("This relationship already exists.");
    this.name = "RelationshipExistsError";
  }
}

/** One of the endpoints is missing or belongs to another workspace. */
export class RelationshipEndpointError extends Error {
  constructor() {
    super("Both resources must exist in this workspace.");
    this.name = "RelationshipEndpointError";
  }
}

export interface ResourceRef {
  id: string;
  name: string;
  type: ResourceType;
  environment: Environment | null;
  status: ResourceStatus;
}

export interface RelationshipView {
  id: string;
  type: RelationshipType;
  origin: RelationshipOrigin;
  status: RelationshipStatus;
  note: string | null;
  from: ResourceRef;
  to: ResourceRef;
  createdAt: Date;
  confirmedAt: Date | null;
}

const refSelect = { id: true, name: true, type: true, environment: true, status: true } as const;
const MAX_ID_LENGTH = 64;

function sentence(fromName: string, type: RelationshipType, toName: string): string {
  return `${fromName} ${RELATIONSHIP_TYPE_INFO[type].label} ${toName}`;
}

// ───────────────────────── Reads ─────────────────────────

/** All relationships touching a resource (both directions), oldest first. */
export async function listRelationshipsForResource(
  ctx: WorkspaceContext,
  resourceId: string,
): Promise<RelationshipView[]> {
  return tenantDb(ctx).relationship.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [{ fromResourceId: resourceId }, { toResourceId: resourceId }],
    },
    select: {
      id: true,
      type: true,
      origin: true,
      status: true,
      note: true,
      createdAt: true,
      confirmedAt: true,
      from: { select: refSelect },
      to: { select: refSelect },
    },
    orderBy: { createdAt: "asc" },
  });
}

// ───────────────────────── Writes (MEMBER+) ─────────────────────────

export async function createRelationship(
  ctx: WorkspaceContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  assertRole(ctx, "MEMBER");
  const input = relationshipCreateSchema.parse(rawInput);

  try {
    return await tenantDb(ctx).$transaction(async (tx) => {
      const endpoints = await tx.resource.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          id: { in: [input.fromResourceId, input.toResourceId] },
        },
        select: { id: true, name: true },
      });
      const from = endpoints.find((r) => r.id === input.fromResourceId);
      const to = endpoints.find((r) => r.id === input.toResourceId);
      if (!from || !to) throw new RelationshipEndpointError();

      const now = new Date();
      const created = await tx.relationship.create({
        data: {
          workspaceId: ctx.workspaceId,
          fromResourceId: from.id,
          toResourceId: to.id,
          type: input.type,
          note: input.note,
          // Manual relationships are human statements: confirmed by definition.
          origin: "MANUAL",
          status: "CONFIRMED",
          confirmedById: ctx.userId,
          confirmedAt: now,
        },
      });
      await recordUserChange(tx, ctx, {
        subjectType: "RELATIONSHIP",
        subjectId: created.id,
        subjectLabel: `${from.name} → ${to.name}`,
        kind: "CREATED",
        summary: `Added relationship: ${sentence(from.name, input.type, to.name)}`,
        resourceIds: [from.id, to.id],
      });
      return { id: created.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new RelationshipExistsError();
    }
    throw error;
  }
}

async function findOwned(tx: Prisma.TransactionClient, ctx: WorkspaceContext, id: string) {
  if (!id || id.length > MAX_ID_LENGTH) throw new RelationshipNotFoundError();
  const relationship = await tx.relationship.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { from: { select: { name: true } }, to: { select: { name: true } } },
  });
  if (!relationship) throw new RelationshipNotFoundError();
  return relationship;
}

export async function updateRelationship(
  ctx: WorkspaceContext,
  id: string,
  rawInput: unknown,
): Promise<void> {
  assertRole(ctx, "MEMBER");
  const input = relationshipUpdateSchema.parse(rawInput);

  try {
    await tenantDb(ctx).$transaction(async (tx) => {
      const before = await findOwned(tx, ctx, id);
      await tx.relationship.update({ where: { id: before.id }, data: input });

      const diff: Record<string, [unknown, unknown]> = {};
      if (before.type !== input.type) diff.type = [before.type, input.type];
      if ((before.note ?? null) !== input.note) diff.note = [before.note, input.note];
      if (Object.keys(diff).length === 0) return;

      await recordUserChange(tx, ctx, {
        subjectType: "RELATIONSHIP",
        subjectId: before.id,
        subjectLabel: `${before.from.name} → ${before.to.name}`,
        kind: "UPDATED",
        summary: `Updated relationship: ${sentence(before.from.name, input.type, before.to.name)}`,
        diff: diff as Prisma.InputJsonValue,
        resourceIds: [before.fromResourceId, before.toResourceId],
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new RelationshipExistsError();
    }
    throw error;
  }
}

// ───────────────────────── Reviewing suggestions (MEMBER+) ─────────────────────────

export class RelationshipAlreadyReviewedError extends Error {
  constructor() {
    super("This suggestion was already reviewed.");
    this.name = "RelationshipAlreadyReviewedError";
  }
}

/**
 * Confirms a DETECTED/INFERRED suggestion — optionally with a more precise
 * type ("Add context", e.g. CONNECTS_TO → USES_DATABASE) and a note. The
 * origin stays DETECTED (how we learned it); the status becomes CONFIRMED.
 */
export async function confirmRelationship(
  ctx: WorkspaceContext,
  id: string,
  rawInput: unknown = {},
): Promise<void> {
  assertRole(ctx, "MEMBER");
  const input = relationshipUpdateSchema.partial().parse(rawInput);
  try {
    await tenantDb(ctx).$transaction(async (tx) => {
      const rel = await findOwned(tx, ctx, id);
      if (rel.status !== "UNCONFIRMED") throw new RelationshipAlreadyReviewedError();
      const type = input.type ?? rel.type;
      await tx.relationship.update({
        where: { id: rel.id },
        data: {
          status: "CONFIRMED",
          type,
          ...(input.note !== undefined ? { note: input.note } : {}),
          confirmedById: ctx.userId,
          confirmedAt: new Date(),
        },
      });
      await recordUserChange(tx, ctx, {
        subjectType: "RELATIONSHIP",
        subjectId: rel.id,
        subjectLabel: `${rel.from.name} → ${rel.to.name}`,
        kind: "CONFIRMED",
        summary: `Confirmed relationship: ${sentence(rel.from.name, type, rel.to.name)}`,
        ...(type !== rel.type ? { diff: { type: [rel.type, type] } } : {}),
        resourceIds: [rel.fromResourceId, rel.toResourceId],
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new RelationshipExistsError();
    }
    throw error;
  }
}

/** Ignores a suggestion. It is kept, so discovery never suggests the pair again. */
export async function ignoreRelationship(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "MEMBER");
  await tenantDb(ctx).$transaction(async (tx) => {
    const rel = await findOwned(tx, ctx, id);
    if (rel.status !== "UNCONFIRMED") throw new RelationshipAlreadyReviewedError();
    await tx.relationship.update({ where: { id: rel.id }, data: { status: "IGNORED" } });
    await recordUserChange(tx, ctx, {
      subjectType: "RELATIONSHIP",
      subjectId: rel.id,
      subjectLabel: `${rel.from.name} → ${rel.to.name}`,
      kind: "IGNORED",
      summary: `Ignored suggestion: ${rel.from.name} → ${rel.to.name}`,
      resourceIds: [rel.fromResourceId, rel.toResourceId],
    });
  });
}

export async function deleteRelationship(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "MEMBER");
  await tenantDb(ctx).$transaction(async (tx) => {
    const rel = await findOwned(tx, ctx, id);
    await tx.relationship.delete({ where: { id: rel.id } });
    await recordUserChange(tx, ctx, {
      subjectType: "RELATIONSHIP",
      subjectId: rel.id,
      subjectLabel: `${rel.from.name} → ${rel.to.name}`,
      kind: "DELETED",
      summary: `Removed relationship: ${sentence(rel.from.name, rel.type, rel.to.name)}`,
      resourceIds: [rel.fromResourceId, rel.toResourceId],
    });
  });
}

// ───────────────────────── Bulk review (M15, MEMBER+) ─────────────────────────

/** Most suggestions one review action can touch (the inbox lists up to this many). */
export const REVIEW_BULK_LIMIT = 1000;
const reviewIdsSchema = z.array(z.string().min(1).max(MAX_ID_LENGTH)).min(1).max(REVIEW_BULK_LIMIT);

/**
 * Confirms many suggestions at once. With `useSuggestedType`, each takes the
 * type its evidence suggests (port 1433 → uses database) unless that would
 * duplicate an existing relationship of the pair, in which case it keeps its
 * type. Already reviewed or missing ids are skipped. Returns how many changed.
 */
export async function confirmRelationships(
  ctx: WorkspaceContext,
  rawIds: unknown,
  options: { useSuggestedType?: boolean } = {},
): Promise<number> {
  assertRole(ctx, "MEMBER");
  const ids = reviewIdsSchema.parse(rawIds);
  return tenantDb(ctx).$transaction(
    async (tx) => {
      const rels = await tx.relationship.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: ids }, status: "UNCONFIRMED" },
        select: {
          id: true,
          type: true,
          fromResourceId: true,
          toResourceId: true,
          from: { select: { name: true } },
          to: { select: { name: true } },
          evidence: { select: { port: true } },
        },
      });
      if (rels.length === 0) return 0;
      const taken = new Set(
        (
          await tx.relationship.findMany({
            where: {
              workspaceId: ctx.workspaceId,
              fromResourceId: { in: rels.map((r) => r.fromResourceId) },
            },
            select: { fromResourceId: true, toResourceId: true, type: true },
          })
        ).map((r) => `${r.fromResourceId}|${r.toResourceId}|${r.type}`),
      );
      const now = new Date();
      const byType = new Map<RelationshipType, string[]>();
      for (const rel of rels) {
        let type = rel.type;
        const suggested = options.useSuggestedType
          ? suggestedTypeForPorts(rel.evidence.map((e) => e.port))
          : null;
        const key = (t: RelationshipType) => `${rel.fromResourceId}|${rel.toResourceId}|${t}`;
        if (suggested && suggested !== rel.type && !taken.has(key(suggested))) {
          taken.delete(key(rel.type));
          taken.add(key(suggested));
          type = suggested;
        }
        byType.set(type, [...(byType.get(type) ?? []), rel.id]);
      }
      // One statement per resulting type (the unique key includes the type).
      for (const [type, typeIds] of byType) {
        await tx.relationship.updateMany({
          where: { workspaceId: ctx.workspaceId, id: { in: typeIds }, status: "UNCONFIRMED" },
          data: { status: "CONFIRMED", type, confirmedById: ctx.userId, confirmedAt: now },
        });
      }
      await tx.changeEvent.createMany({
        data: rels.map((rel) => ({
          workspaceId: ctx.workspaceId,
          actorType: "USER" as const,
          actorId: ctx.userId,
          subjectType: "RELATIONSHIP" as const,
          subjectId: rel.id,
          subjectLabel: `${rel.from.name} → ${rel.to.name}`,
          kind: "CONFIRMED" as const,
          summary: `Confirmed relationship: ${rel.from.name} → ${rel.to.name}`,
          resourceIds: [rel.fromResourceId, rel.toResourceId],
        })),
      });
      return rels.length;
    },
    { timeout: 60_000 },
  );
}

/** Ignores many suggestions at once (kept as IGNORED: never suggested again). */
export async function ignoreRelationships(ctx: WorkspaceContext, rawIds: unknown): Promise<number> {
  return setReviewStatus(ctx, rawIds, "UNCONFIRMED", "IGNORED");
}

/** "Undo ignore": puts ignored suggestions back into the inbox. */
export async function restoreRelationships(
  ctx: WorkspaceContext,
  rawIds: unknown,
): Promise<number> {
  return setReviewStatus(ctx, rawIds, "IGNORED", "UNCONFIRMED");
}

async function setReviewStatus(
  ctx: WorkspaceContext,
  rawIds: unknown,
  from: "UNCONFIRMED" | "IGNORED",
  to: "UNCONFIRMED" | "IGNORED",
): Promise<number> {
  assertRole(ctx, "MEMBER");
  const ids = reviewIdsSchema.parse(rawIds);
  return tenantDb(ctx).$transaction(
    async (tx) => {
      const rels = await tx.relationship.findMany({
        where: { workspaceId: ctx.workspaceId, id: { in: ids }, status: from },
        select: {
          id: true,
          fromResourceId: true,
          toResourceId: true,
          from: { select: { name: true } },
          to: { select: { name: true } },
        },
      });
      if (rels.length === 0) return 0;
      await tx.relationship.updateMany({
        where: { workspaceId: ctx.workspaceId, id: { in: rels.map((r) => r.id) }, status: from },
        data: { status: to },
      });
      await tx.changeEvent.createMany({
        data: rels.map((rel) => {
          const label = `${rel.from.name} → ${rel.to.name}`;
          return {
            workspaceId: ctx.workspaceId,
            actorType: "USER" as const,
            actorId: ctx.userId,
            subjectType: "RELATIONSHIP" as const,
            subjectId: rel.id,
            subjectLabel: label,
            kind: to === "IGNORED" ? ("IGNORED" as const) : ("UPDATED" as const),
            summary:
              to === "IGNORED" ? `Ignored suggestion: ${label}` : `Restored suggestion: ${label}`,
            ...(to === "UNCONFIRMED" ? { diff: { status: ["IGNORED", "UNCONFIRMED"] } } : {}),
            resourceIds: [rel.fromResourceId, rel.toResourceId],
          };
        }),
      });
      return rels.length;
    },
    { timeout: 60_000 },
  );
}
