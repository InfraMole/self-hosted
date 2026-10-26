// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Database clients reported by an agent on a database host → DETECTED
 * "uses database" suggestions with DB_SESSION evidence (M42). The engine
 * itself listed the sessions, so they are observed, not inferred; a client
 * that is gone keeps its evidence (sessions come and go).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { tenantDb } from "@/server/db";
import type { ReportV1 } from "@/server/modules/agents/protocol";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";
import { databaseKey, planDatabaseClients } from "./db-clients-plan";
import { buildIpIndex } from "./plan";
import { guessProtocol } from "./protocols";

const WORKLOAD_PREFIX = "workloads:";

export async function refreshDatabaseClients(
  workspaceId: string,
  agentId: string,
  hostId: string,
  clients: NonNullable<ReportV1["databaseClients"]>,
  now = new Date(),
): Promise<{ created: number }> {
  if (clients.length === 0) return { created: 0 };
  const db = tenantDb({ workspaceId });
  const [resources, rules] = await Promise.all([
    db.resource.findMany({
      where: { workspaceId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, metadata: true, source: true, externalId: true },
    }),
    db.discoveryRule.findMany({
      where: { workspaceId },
      select: { id: true, port: true, processName: true, resourceId: true },
    }),
  ]);
  // Databases of this host, from its workloads import (ADR-028 keys).
  const databases = new Map<string, string>();
  const hostPrefix = `${WORKLOAD_PREFIX}${hostId}/`;
  for (const r of resources) {
    if (r.source === "IMPORT" && r.externalId?.startsWith(hostPrefix))
      databases.set(r.externalId.slice(WORKLOAD_PREFIX.length), r.id);
  }
  if (!clients.some((c) => databases.has(databaseKey(hostId, c.engine, c.instance, c.database))))
    return { created: 0 };
  const targets = [...new Set(databases.values())];
  const relationships = await db.relationship.findMany({
    where: {
      workspaceId,
      OR: [{ toResourceId: { in: targets } }, { fromResourceId: { in: targets } }],
    },
    select: {
      id: true,
      fromResourceId: true,
      toResourceId: true,
      status: true,
      lastObservedAt: true,
      evidence: { where: { kind: "DB_SESSION" }, select: { id: true } },
    },
  });
  const index = buildIpIndex(
    resources.map((r) => {
      const meta = resourceMetadataSchema.safeParse(r.metadata);
      return { id: r.id, ipAddresses: meta.success ? (meta.data.ipAddresses ?? []) : [] };
    }),
  );
  const plan = planDatabaseClients(
    hostId,
    clients,
    databases,
    index,
    relationships.map((r) => ({
      id: r.id,
      from: r.fromResourceId,
      to: r.toResourceId,
      status: r.status,
    })),
    rules,
  );
  if (plan.create.length === 0 && plan.refresh.length === 0) return { created: 0 };

  const names = new Map(resources.map((r) => [r.id, r.name]));
  const evidence = (port: number, sessions: number) => ({
    workspaceId,
    kind: "DB_SESSION" as const,
    port,
    protocolGuess: guessProtocol(port)?.name ?? null,
    processName: null,
    sampleCount: sessions,
    lastSeenAt: now,
  });
  const byId = new Map(relationships.map((r) => [r.id, r]));

  await db.$transaction(async (tx) => {
    for (const c of plan.create) {
      const id = randomUUID();
      await tx.relationship.create({
        data: {
          id,
          workspaceId,
          fromResourceId: c.from,
          toResourceId: c.to,
          type: "USES_DATABASE",
          origin: "DETECTED",
          status: "UNCONFIRMED",
          firstObservedAt: now,
          lastObservedAt: now,
        },
      });
      await tx.relationshipEvidence.create({
        data: { ...evidence(c.port, c.sessions), relationshipId: id, firstSeenAt: now },
      });
      const from = names.get(c.from) ?? "?";
      const to = names.get(c.to) ?? "?";
      await tx.changeEvent.create({
        data: {
          workspaceId,
          actorType: "AGENT",
          actorId: agentId,
          subjectType: "RELATIONSHIP",
          subjectId: id,
          subjectLabel: `${from} → ${to}`,
          kind: "DISCOVERED",
          summary: `Seen in the database server's sessions: ${from} uses database ${to}`,
          resourceIds: [c.from, c.to],
        },
      });
    }
    for (const r of plan.refresh) {
      const existing = byId.get(r.relationshipId)?.evidence[0]?.id;
      if (existing)
        await tx.relationshipEvidence.update({
          where: { id: existing },
          data: { port: r.port, sampleCount: r.sessions, lastSeenAt: now },
        });
      else
        await tx.relationshipEvidence.create({
          data: {
            ...evidence(r.port, r.sessions),
            relationshipId: r.relationshipId,
            firstSeenAt: now,
          },
        });
      const observed = byId.get(r.relationshipId)?.lastObservedAt;
      if (!observed || observed < now)
        await tx.relationship.update({
          where: { id: r.relationshipId },
          data: { lastObservedAt: now },
        });
    }
  });
  return { created: plan.create.length };
}
