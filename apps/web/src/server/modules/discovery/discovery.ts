// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { randomUUID } from "node:crypto";
import { RELATIONSHIP_TYPE_INFO } from "@depmap/graph";
import type { Prisma } from "@/generated/prisma/client";
import type { WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import type { ResourceRef } from "@/server/modules/relationships/relationships";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";
import { excludedSuggestions, planDiscovery, type FactInput } from "./plan";
import { guessProtocol, suggestedTypeForPorts } from "./protocols";

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
 * Turns resolved connection facts into DETECTED suggestions or evidence (see
 * plan.ts), honouring the workspace's exclusion rules. Idempotent.
 *
 * - `onlyAgentFacts` (after a report that changed no IP address): only that
 *   agent's facts are re-planned — nothing else can have changed (M15).
 * - Otherwise (IPs changed, an import, a rule added or removed) the whole
 *   workspace is re-planned, and unreviewed suggestions explained only by
 *   excluded traffic are removed.
 */
export async function refreshDetectedRelationships(
  workspaceId: string,
  actor: { agentId?: string; userId?: string } = {},
  options: { onlyAgentFacts?: boolean } = {},
): Promise<{ created: number; removed: number }> {
  const db = tenantDb({ workspaceId });
  const incremental = !!(options.onlyAgentFacts && actor.agentId);
  const factScope = incremental ? { workspaceId, agentId: actor.agentId } : { workspaceId };
  const [resources, facts, relationships, rules] = await Promise.all([
    db.resource.findMany({
      where: { workspaceId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, metadata: true },
    }),
    db.connectionFact.findMany({
      where: factScope,
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
      select: {
        id: true,
        fromResourceId: true,
        toResourceId: true,
        status: true,
        lastObservedAt: true,
      },
    }),
    db.discoveryRule.findMany({
      where: { workspaceId },
      select: { id: true, port: true, processName: true, resourceId: true },
    }),
  ]);
  // Unreviewed suggestions that the exclusion rules now fully explain.
  const removals =
    rules.length > 0 && !incremental
      ? excludedSuggestions(
          (
            await db.relationship.findMany({
              where: { workspaceId, status: "UNCONFIRMED", evidence: { some: {} } },
              select: {
                id: true,
                fromResourceId: true,
                toResourceId: true,
                evidence: { select: { port: true, processName: true } },
              },
            })
          ).map((r) => ({
            relationshipId: r.id,
            from: r.fromResourceId,
            to: r.toResourceId,
            evidence: r.evidence,
          })),
          rules,
        )
      : [];
  if (facts.length === 0 && removals.length === 0) return { created: 0, removed: 0 };

  const names = new Map(resources.map((r) => [r.id, r.name]));
  const lastObserved = new Map(relationships.map((r) => [r.id, r.lastObservedAt]));
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
    { rules },
  );

  await db.$transaction(
    async (tx) => {
      // Group resolution updates by target: one statement per remote resource.
      const byTarget = new Map<string | null, string[]>();
      for (const r of plan.resolutions) {
        byTarget.set(r.remoteResourceId, [...(byTarget.get(r.remoteResourceId) ?? []), r.factId]);
      }
      for (const [remoteResourceId, ids] of byTarget) {
        await tx.connectionFact.updateMany({
          where: { workspaceId, id: { in: ids } },
          data: { remoteResourceId },
        });
      }

      // New suggestions, in batches (first-day discovery can create thousands).
      if (plan.creates.length > 0) {
        const rows = plan.creates.map((pair) => ({
          id: randomUUID(),
          workspaceId,
          fromResourceId: pair.from,
          toResourceId: pair.to,
          type: "CONNECTS_TO" as const,
          origin: "DETECTED" as const,
          status: "UNCONFIRMED" as const,
          firstObservedAt: minDate(pair.facts.map((f) => f.firstSeenAt)),
          lastObservedAt: maxDate(pair.facts.map((f) => f.lastSeenAt)),
        }));
        await tx.relationship.createMany({ data: rows, skipDuplicates: true });
        const inserted = new Set(
          (
            await tx.relationship.findMany({
              where: { workspaceId, id: { in: rows.map((r) => r.id) } },
              select: { id: true },
            })
          ).map((r) => r.id),
        );
        const made = plan.creates
          .map((pair, i) => ({ pair, id: rows[i]!.id }))
          .filter(({ id }) => inserted.has(id));
        await tx.relationshipEvidence.createMany({
          data: made.flatMap(({ pair, id }) =>
            pair.facts.map((f) => ({ ...evidenceData(f), workspaceId, relationshipId: id })),
          ),
        });
        await tx.changeEvent.createMany({
          data: made.map(({ pair, id }) => {
            const ports = [...new Set(pair.facts.map((f) => f.port))].sort((a, b) => a - b);
            const guess = guessProtocol(ports[0]!);
            return {
              workspaceId,
              actorType: actor.agentId ? ("AGENT" as const) : ("SYSTEM" as const),
              actorId: actor.agentId ?? null,
              subjectType: "RELATIONSHIP" as const,
              subjectId: id,
              subjectLabel: `${names.get(pair.from)} → ${names.get(pair.to)}`,
              kind: "DISCOVERED" as const,
              summary: `Detected connection: ${names.get(pair.from)} → ${names.get(pair.to)}:${ports.join(",")}${guess ? ` (likely ${guess.name})` : ""}`,
              resourceIds: [pair.from, pair.to],
            };
          }),
        });
      }

      // Evidence on existing relationships: write only what changed.
      if (plan.evidence.length > 0) {
        const current = new Map(
          (
            await tx.relationshipEvidence.findMany({
              where: {
                workspaceId,
                relationshipId: { in: plan.evidence.map((e) => e.relationshipId) },
              },
              select: {
                id: true,
                relationshipId: true,
                connectionFactId: true,
                sampleCount: true,
                lastSeenAt: true,
              },
            })
          ).map((e) => [`${e.relationshipId}|${e.connectionFactId}`, e]),
        );
        const toCreate: Prisma.RelationshipEvidenceCreateManyInput[] = [];
        for (const e of plan.evidence) {
          for (const f of e.facts) {
            const row = current.get(`${e.relationshipId}|${f.id}`);
            if (!row)
              toCreate.push({ ...evidenceData(f), workspaceId, relationshipId: e.relationshipId });
            else if (
              row.sampleCount !== f.sampleCount ||
              row.lastSeenAt.getTime() !== f.lastSeenAt.getTime()
            )
              await tx.relationshipEvidence.update({
                where: { id: row.id },
                data: evidenceData(f),
              });
          }
          const last = maxDate(e.facts.map((f) => f.lastSeenAt));
          const observed = lastObserved.get(e.relationshipId);
          if (!observed || observed < last)
            await tx.relationship.update({
              where: { id: e.relationshipId },
              data: { lastObservedAt: last },
            });
        }
        if (toCreate.length > 0)
          await tx.relationshipEvidence.createMany({ data: toCreate, skipDuplicates: true });
      }

      if (removals.length > 0) {
        const removed = await tx.relationship.findMany({
          where: { workspaceId, id: { in: removals }, status: "UNCONFIRMED" },
          select: { id: true, fromResourceId: true, toResourceId: true },
        });
        await tx.relationship.deleteMany({
          where: { workspaceId, id: { in: removed.map((r) => r.id) } },
        });
        await tx.changeEvent.createMany({
          data: removed.map((r) => {
            const label = `${names.get(r.fromResourceId) ?? "?"} → ${names.get(r.toResourceId) ?? "?"}`;
            return {
              workspaceId,
              actorType: actor.userId ? ("USER" as const) : ("SYSTEM" as const),
              actorId: actor.userId ?? null,
              subjectType: "RELATIONSHIP" as const,
              subjectId: r.id,
              subjectLabel: label,
              kind: "DELETED" as const,
              summary: `Suggestion removed by an exclusion rule: ${label}`,
              resourceIds: [r.fromResourceId, r.toResourceId],
            };
          }),
        });
      }
    },
    { timeout: 60_000 },
  );
  return { created: plan.creates.length, removed: removals.length };
}

function evidenceData(f: FactInput) {
  return {
    connectionFactId: f.id,
    port: f.port,
    protocolGuess: guessProtocol(f.port)?.name ?? null,
    processName: f.processName || null,
    sampleCount: f.sampleCount,
    firstSeenAt: f.firstSeenAt,
    lastSeenAt: f.lastSeenAt,
  };
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

/** Inbox size: the page lists (and bulk actions accept) at most this many. */
export const SUGGESTIONS_PAGE = 1000;

/** Suggestions to review (default) or ignored ones ("undo ignore", M15), newest first. */
export async function listSuggestions(
  ctx: WorkspaceContext,
  status: "UNCONFIRMED" | "IGNORED" = "UNCONFIRMED",
): Promise<SuggestionView[]> {
  const rels = await tenantDb(ctx).relationship.findMany({
    where: { workspaceId: ctx.workspaceId, status },
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
    orderBy:
      status === "IGNORED"
        ? [{ updatedAt: "desc" }]
        : [{ lastObservedAt: "desc" }, { createdAt: "desc" }],
    take: SUGGESTIONS_PAGE,
  });
  return rels.map(({ evidence, ...r }) => ({
    ...r,
    evidence: summarise(evidence),
  }));
}

export async function countSuggestions(
  ctx: WorkspaceContext,
  status: "UNCONFIRMED" | "IGNORED" = "UNCONFIRMED",
): Promise<number> {
  return tenantDb(ctx).relationship.count({
    where: { workspaceId: ctx.workspaceId, status },
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
  return {
    ports,
    protocols: [...new Set(evidence.map((e) => e.protocolGuess).filter((p): p is string => !!p))],
    processes: [...new Set(evidence.map((e) => e.processName).filter((p): p is string => !!p))],
    samples: evidence.reduce((n, e) => n + e.sampleCount, 0),
    firstSeenAt: evidence.length ? minDate(evidence.map((e) => e.firstSeenAt)) : null,
    lastSeenAt: evidence.length ? maxDate(evidence.map((e) => e.lastSeenAt)) : null,
    suggestedType: suggestedTypeForPorts(ports),
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
