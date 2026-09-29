// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
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
