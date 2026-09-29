// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { randomUUID } from "node:crypto";
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
import type { Prisma } from "@/generated/prisma/client";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import { recordAgentChange } from "@/server/modules/changes/changes";
import type { ResourceRef } from "@/server/modules/relationships/relationships";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";
import { planDiscovery, type FactInput } from "./plan";
import { guessProtocol } from "./protocols";

/** Facts not seen for this long are deleted (per agent, on ingest). */
export const FACT_RETENTION_DAYS = 30;

const ts = (d: Date) => d.toISOString().replace("Z", ""); // Prisma DateTime = timestamp(3) in UTC

/**
 * Folds a report's aggregated connections into ConnectionFacts with ONE
 * statement (INSERT … ON CONFLICT DO UPDATE over unnest arrays).
 */
export async function upsertConnectionFacts(
  tx: Prisma.TransactionClient,
  agent: { id: string; workspaceId: string },
  sourceResourceId: string,
  connections: ReportV1["connections"],
): Promise<void> {
  const merged = new Map<
    string,
    {
      direction: string;
      ip: string;
      port: number;
      proc: string;
      count: number;
      first: Date;
      last: Date;
    }
  >();
  for (const c of connections) {
    const direction = c.direction === "inbound" ? "INBOUND" : "OUTBOUND";
    const port = c.direction === "inbound" ? c.localPort : c.remotePort;
    const proc = c.process?.name ?? "";
    const key = `${direction}|${c.remoteAddress}|${port}|${proc}`;
    const first = new Date(c.firstSeen);
    const last = new Date(c.lastSeen);
    const existing = merged.get(key);
    if (existing) {
      existing.count += c.count;
      if (first < existing.first) existing.first = first;
      if (last > existing.last) existing.last = last;
    } else {
      merged.set(key, {
        direction,
        ip: c.remoteAddress.toLowerCase(),
        port,
        proc,
        count: c.count,
        first,
        last,
      });
    }
  }
  const rows = [...merged.values()];
  if (rows.length > 0) {
    await tx.$executeRaw`
      INSERT INTO "connection_fact"
        ("id","workspaceId","agentId","sourceResourceId","direction","remoteIp","port","processName",
         "sampleCount","reportCount","firstSeenAt","lastSeenAt")
      SELECT u.id, ${agent.workspaceId}, ${agent.id}, ${sourceResourceId}, u.direction::"ConnectionDirection",
             u.ip, u.port, u.proc, u.cnt, 1, u.first, u.last
      FROM unnest(
        ${rows.map(() => randomUUID())}::text[],
        ${rows.map((r) => r.direction)}::text[],
        ${rows.map((r) => r.ip)}::text[],
        ${rows.map((r) => r.port)}::int[],
        ${rows.map((r) => r.proc)}::text[],
        ${rows.map((r) => r.count)}::int[],
        ${rows.map((r) => ts(r.first))}::timestamp(3)[],
        ${rows.map((r) => ts(r.last))}::timestamp(3)[]
      ) AS u(id, direction, ip, port, proc, cnt, first, last)
      ON CONFLICT ("agentId","direction","remoteIp","port","processName") DO UPDATE SET
        "sampleCount" = "connection_fact"."sampleCount" + EXCLUDED."sampleCount",
        "reportCount" = "connection_fact"."reportCount" + 1,
        "lastSeenAt" = GREATEST("connection_fact"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "sourceResourceId" = EXCLUDED."sourceResourceId"`;
  }
  await tx.connectionFact.deleteMany({
    where: {
      agentId: agent.id,
      lastSeenAt: { lt: new Date(Date.now() - FACT_RETENTION_DAYS * 86_400_000) },
    },
  });
}

/**
 * Re-resolves every fact of the workspace and turns resolved connections into
 * DETECTED suggestions or evidence (see plan.ts). Idempotent; safe to call
 * after each report and after a resource's IPs change.
 */
export async function refreshDetectedRelationships(
  workspaceId: string,
  actor: { agentId?: string } = {},
): Promise<{ created: number }> {
  const db = tenantDb({ workspaceId });
  const [resources, facts, relationships] = await Promise.all([
    db.resource.findMany({
      where: { workspaceId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, metadata: true },
    }),
    db.connectionFact.findMany({
      where: { workspaceId },
      select: {
        id: true,
        sourceResourceId: true,
        direction: true,
        remoteIp: true,
        port: true,
        processName: true,
        sampleCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        remoteResourceId: true,
      },
    }),
    db.relationship.findMany({
      where: { workspaceId },
      select: { id: true, fromResourceId: true, toResourceId: true, status: true },
    }),
  ]);
  if (facts.length === 0) return { created: 0 };

  const names = new Map(resources.map((r) => [r.id, r.name]));
  const plan = planDiscovery(
    facts,
    resources.map((r) => {
      const meta = resourceMetadataSchema.safeParse(r.metadata);
      return { id: r.id, ipAddresses: meta.success ? (meta.data.ipAddresses ?? []) : [] };
    }),
    relationships.map((r) => ({
      id: r.id,
      from: r.fromResourceId,
      to: r.toResourceId,
      status: r.status,
    })),
  );

  await db.$transaction(async (tx) => {
    for (const r of plan.resolutions) {
      await tx.connectionFact.updateMany({
        where: { id: r.factId, workspaceId },
        data: { remoteResourceId: r.remoteResourceId },
      });
    }

    for (const pair of plan.creates) {
      const first = minDate(pair.facts.map((f) => f.firstSeenAt));
      const last = maxDate(pair.facts.map((f) => f.lastSeenAt));
      const rel = await tx.relationship.upsert({
        where: {
          workspaceId_fromResourceId_toResourceId_type: {
            workspaceId,
            fromResourceId: pair.from,
            toResourceId: pair.to,
            type: "CONNECTS_TO",
          },
        },
        create: {
          workspaceId,
          fromResourceId: pair.from,
          toResourceId: pair.to,
          type: "CONNECTS_TO",
          origin: "DETECTED",
          status: "UNCONFIRMED",
          firstObservedAt: first,
          lastObservedAt: last,
        },
        update: {},
      });
      await upsertEvidence(tx, workspaceId, rel.id, pair.facts);

      const ports = [...new Set(pair.facts.map((f) => f.port))].sort((a, b) => a - b);
      const guess = guessProtocol(ports[0]!);
      const summary = `Detected connection: ${names.get(pair.from)} → ${names.get(pair.to)}:${ports.join(",")}${guess ? ` (likely ${guess.name})` : ""}`;
      const change = {
        subjectType: "RELATIONSHIP" as const,
        subjectId: rel.id,
        subjectLabel: `${names.get(pair.from)} → ${names.get(pair.to)}`,
        kind: "DISCOVERED" as const,
        summary,
        resourceIds: [pair.from, pair.to],
      };
      if (actor.agentId) await recordAgentChange(tx, workspaceId, actor.agentId, change);
      else await tx.changeEvent.create({ data: { ...change, workspaceId, actorType: "SYSTEM" } });
    }

    for (const e of plan.evidence) {
      await upsertEvidence(tx, workspaceId, e.relationshipId, e.facts);
      await tx.relationship.update({
        where: { id: e.relationshipId },
        data: { lastObservedAt: maxDate(e.facts.map((f) => f.lastSeenAt)) },
      });
    }
  });
  return { created: plan.creates.length };
}

async function upsertEvidence(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  relationshipId: string,
  facts: FactInput[],
) {
  for (const f of facts) {
    const data = {
      port: f.port,
      protocolGuess: guessProtocol(f.port)?.name ?? null,
      processName: f.processName || null,
      sampleCount: f.sampleCount,
      firstSeenAt: f.firstSeenAt,
      lastSeenAt: f.lastSeenAt,
    };
    await tx.relationshipEvidence.upsert({
      where: { relationshipId_connectionFactId: { relationshipId, connectionFactId: f.id } },
      create: { ...data, workspaceId, relationshipId, connectionFactId: f.id },
      update: data,
    });
  }
}

const minDate = (d: Date[]) => new Date(Math.min(...d.map((x) => x.getTime())));
const maxDate = (d: Date[]) => new Date(Math.max(...d.map((x) => x.getTime())));

// ───────────────────────── Suggestions inbox ─────────────────────────

export interface EvidenceSummary {
  ports: number[];
  protocols: string[];
  processes: string[];
  samples: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  /** Suggested relationship type from the first recognised port. */
  suggestedType: keyof typeof RELATIONSHIP_TYPE_INFO | null;
}

export interface SuggestionView {
  id: string;
  type: keyof typeof RELATIONSHIP_TYPE_INFO;
  origin: "MANUAL" | "DETECTED" | "INFERRED";
  note: string | null;
  from: ResourceRef;
  to: ResourceRef;
  evidence: EvidenceSummary;
}

const refSelect = { id: true, name: true, type: true, environment: true, status: true } as const;

export async function listSuggestions(ctx: WorkspaceContext): Promise<SuggestionView[]> {
  const rels = await tenantDb(ctx).relationship.findMany({
    where: { workspaceId: ctx.workspaceId, status: "UNCONFIRMED" },
    select: {
      id: true,
      type: true,
      origin: true,
      note: true,
      from: { select: refSelect },
      to: { select: refSelect },
      evidence: {
        select: {
          port: true,
          protocolGuess: true,
          processName: true,
          sampleCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
        },
      },
    },
    orderBy: [{ lastObservedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rels.map(({ evidence, ...r }) => ({
    ...r,
    evidence: summarise(evidence),
  }));
}

export async function countSuggestions(ctx: WorkspaceContext): Promise<number> {
  return tenantDb(ctx).relationship.count({
    where: { workspaceId: ctx.workspaceId, status: "UNCONFIRMED" },
  });
}

function summarise(
  evidence: {
    port: number;
    protocolGuess: string | null;
    processName: string | null;
    sampleCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }[],
): EvidenceSummary {
  const ports = [...new Set(evidence.map((e) => e.port))].sort((a, b) => a - b);
  const firstGuess = ports.map(guessProtocol).find(Boolean) ?? null;
  return {
    ports,
    protocols: [...new Set(evidence.map((e) => e.protocolGuess).filter((p): p is string => !!p))],
    processes: [...new Set(evidence.map((e) => e.processName).filter((p): p is string => !!p))],
    samples: evidence.reduce((n, e) => n + e.sampleCount, 0),
    firstSeenAt: evidence.length ? minDate(evidence.map((e) => e.firstSeenAt)) : null,
    lastSeenAt: evidence.length ? maxDate(evidence.map((e) => e.lastSeenAt)) : null,
    suggestedType: firstGuess?.suggestedType ?? null,
  };
}

// ───────────────────────── Host view ─────────────────────────

export interface HostDiscovery {
  agent: { hostname: string; lastSeenAt: Date | null; status: string };
  observedAt: Date | null;
  listeners: { address: string; port: number; process: string | null }[];
  serviceCount: number;
  unknownEndpoints: {
    remoteIp: string;
    port: number;
    direction: "INBOUND" | "OUTBOUND";
    processName: string;
    sampleCount: number;
    lastSeenAt: Date;
  }[];
}

/** What the agent on this host observed (null if the resource has no agent). */
export async function getHostDiscovery(
  ctx: WorkspaceContext,
  resourceId: string,
): Promise<HostDiscovery | null> {
  const db = tenantDb(ctx);
  const agent = await db.agent.findFirst({
    where: { workspaceId: ctx.workspaceId, resourceId },
    select: { id: true, hostname: true, lastSeenAt: true, status: true },
  });
  if (!agent) return null;
  const [latest, unknown] = await Promise.all([
    db.observation.findFirst({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true, payload: true },
    }),
    db.connectionFact.findMany({
      where: { agentId: agent.id, workspaceId: ctx.workspaceId, remoteResourceId: null },
      orderBy: [{ sampleCount: "desc" }],
      take: 25,
      select: {
        remoteIp: true,
        port: true,
        direction: true,
        processName: true,
        sampleCount: true,
        lastSeenAt: true,
      },
    }),
  ]);
  const payload = latest?.payload as Partial<ReportV1> | undefined;
  return {
    agent: { hostname: agent.hostname, lastSeenAt: agent.lastSeenAt, status: agent.status },
    observedAt: latest?.receivedAt ?? null,
    listeners: (payload?.listeners ?? [])
      .filter((l, i, all) => all.findIndex((x) => x.port === l.port) === i)
      .slice(0, 50)
      .map((l) => ({ address: l.address, port: l.port, process: l.process?.name ?? null })),
    serviceCount: payload?.services?.length ?? 0,
    unknownEndpoints: unknown,
  };
}
