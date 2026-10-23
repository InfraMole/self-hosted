// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DNS servers reported by an agent → INFERRED suggestions (M39). Each report
 * carrying `dnsServers` replaces what that host's DNS evidence says: new
 * resolvers become suggestions, resolvers no longer configured lose their
 * evidence (and an unreviewed suggestion explained only by it is removed).
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { tenantDb } from "@/server/db";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";
import { DNS_PORT, planDnsSuggestions } from "./dns-plan";
import { buildIpIndex } from "./plan";

export async function refreshDnsSuggestions(
  workspaceId: string,
  agentId: string,
  hostId: string,
  servers: readonly string[],
  now = new Date(),
): Promise<{ created: number; removed: number }> {
  const db = tenantDb({ workspaceId });
  const [resources, fromHost, rules] = await Promise.all([
    db.resource.findMany({
      where: { workspaceId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, metadata: true },
    }),
    db.relationship.findMany({
      where: { workspaceId, fromResourceId: hostId },
      select: {
        id: true,
        toResourceId: true,
        type: true,
        status: true,
        evidence: { select: { id: true, kind: true } },
      },
    }),
    db.discoveryRule.findMany({
      where: { workspaceId },
      select: { id: true, port: true, processName: true, resourceId: true },
    }),
  ]);
  const index = buildIpIndex(
    resources.map((r) => {
      const meta = resourceMetadataSchema.safeParse(r.metadata);
      return { id: r.id, ipAddresses: meta.success ? (meta.data.ipAddresses ?? []) : [] };
    }),
  );
  const plan = planDnsSuggestions(
    hostId,
    servers,
    index,
    fromHost.map((r) => ({
      id: r.id,
      to: r.toResourceId,
      type: r.type,
      status: r.status,
      dns: r.evidence.some((e) => e.kind === "DNS_RESOLVER"),
      other: r.evidence.some((e) => e.kind !== "DNS_RESOLVER"),
    })),
    rules,
  );
  if (Object.values(plan).every((list) => list.length === 0)) return { created: 0, removed: 0 };

  const names = new Map(resources.map((r) => [r.id, r.name]));
  const hostName = names.get(hostId) ?? "?";
  const evidence = {
    workspaceId,
    kind: "DNS_RESOLVER" as const,
    port: DNS_PORT,
    protocolGuess: "DNS",
    processName: null,
    sampleCount: 0,
    lastSeenAt: now,
  };
  const dnsEvidence = new Map(
    fromHost.map((r) => [r.id, r.evidence.find((e) => e.kind === "DNS_RESOLVER")?.id ?? null]),
  );

  await db.$transaction(async (tx) => {
    for (const to of plan.create) {
      const id = randomUUID();
      await tx.relationship.create({
        data: {
          id,
          workspaceId,
          fromResourceId: hostId,
          toResourceId: to,
          type: "DEPENDS_ON",
          origin: "INFERRED",
          status: "UNCONFIRMED",
          // Ordering in the inbox; the evidence says it is configuration.
          firstObservedAt: now,
          lastObservedAt: now,
        },
      });
      await tx.relationshipEvidence.create({
        data: { ...evidence, relationshipId: id, firstSeenAt: now },
      });
      await tx.changeEvent.create({
        data: {
          workspaceId,
          actorType: "AGENT",
          actorId: agentId,
          subjectType: "RELATIONSHIP",
          subjectId: id,
          subjectLabel: `${hostName} → ${names.get(to)}`,
          kind: "DISCOVERED",
          summary: `Configured DNS server: ${hostName} uses ${names.get(to)} (port ${DNS_PORT})`,
          resourceIds: [hostId, to],
        },
      });
    }
    for (const relationshipId of plan.refresh) {
      const existing = dnsEvidence.get(relationshipId);
      if (existing)
        await tx.relationshipEvidence.update({
          where: { id: existing },
          data: { lastSeenAt: now },
        });
      else
        await tx.relationshipEvidence.create({
          data: { ...evidence, relationshipId, firstSeenAt: now },
        });
    }
    for (const relationshipId of plan.strip) {
      await tx.relationshipEvidence.deleteMany({
        where: { workspaceId, relationshipId, kind: "DNS_RESOLVER" },
      });
    }
    if (plan.drop.length > 0) {
      const dropped = fromHost.filter((r) => plan.drop.includes(r.id));
      await tx.relationship.deleteMany({
        where: { workspaceId, id: { in: plan.drop }, status: "UNCONFIRMED" },
      });
      await tx.changeEvent.createMany({
        data: dropped.map((r) => ({
          workspaceId,
          actorType: "AGENT" as const,
          actorId: agentId,
          subjectType: "RELATIONSHIP" as const,
          subjectId: r.id,
          subjectLabel: `${hostName} → ${names.get(r.toResourceId) ?? "?"}`,
          kind: "DELETED" as const,
          summary: `Suggestion removed: ${hostName} no longer uses ${names.get(r.toResourceId) ?? "?"} as DNS server`,
          resourceIds: [hostId, r.toResourceId],
        })),
      });
    }
  });
  return { created: plan.create.length, removed: plan.drop.length };
}
