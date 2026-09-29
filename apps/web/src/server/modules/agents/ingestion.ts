// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import type { Agent, Prisma } from "@/generated/prisma/client";
import { systemDb, tenantDb } from "@/server/db";
import { recordAgentChange } from "@/server/modules/changes/changes";
import {
  refreshDetectedRelationships,
  upsertConnectionFacts,
} from "@/server/modules/discovery/discovery";
import {
  boundedDiff,
  describeIpChange,
  describeObservationDiff,
  diffObserved,
  observedState,
} from "@/server/modules/discovery/host-changes";
import { markStaleHosts, restoreFromStale } from "@/server/modules/discovery/staleness";
import { runImport } from "@/server/modules/importers/importers";
import { recordAudit } from "@/server/modules/audit/audit";
import { assertCanAddNodes } from "@/server/modules/billing/limits";
import { diffResource } from "@/server/modules/resources/diff";
import { resourceMetadataSchema } from "@/server/modules/resources/schemas";
import { agentHostMetadata, mergeHostMetadata } from "./host";
import { agentConfig, type AgentConfig, type EnrollRequest, type ReportV1 } from "./protocol";
import { generateSecret, hashSecret, isWellFormed } from "./secrets";

/** Raw observations are kept this long (docs/DATA_MODEL.md §7). */
export const OBSERVATION_RETENTION_DAYS = 7;

export interface EnrollResult {
  agentId: string;
  agentSecret: string;
  config: AgentConfig;
}

/**
 * Exchanges a valid enrollment token for a per-agent secret. Re-enrolling the
 * same machine (workspace + machineId) reuses the agent and rotates its
 * secret. Returns null for any invalid token (no reason given to the caller).
 */
export async function enrollAgent(
  input: EnrollRequest,
  meta: { ip: string },
): Promise<EnrollResult | null> {
  if (!isWellFormed(input.enrollmentToken, "enrollment")) return null;
  const now = new Date();
  const secret = generateSecret("agent");

  // The token hash is the only key: the workspace is unknown until it is found.
  return systemDb("agent enrollment by token hash").$transaction(async (tx) => {
    const token = await tx.enrollmentToken.findUnique({
      where: { tokenHash: hashSecret(input.enrollmentToken) },
    });
    if (!token || token.revokedAt || token.expiresAt <= now) return null;
    // Atomic use-count check: concurrent enrollments cannot exceed maxUses.
    const { count } = await tx.enrollmentToken.updateMany({
      where: {
        id: token.id,
        ...(token.maxUses !== null ? { useCount: { lt: token.maxUses } } : {}),
      },
      data: { useCount: { increment: 1 } },
    });
    if (count === 0) return null;

    // Plan limit (ADR-019): a new machine becomes a new billable host. Throwing
    // rolls the transaction back, so the token's use is not consumed.
    const known = await tx.agent.findUnique({
      where: {
        workspaceId_machineId: { workspaceId: token.workspaceId, machineId: input.machineId },
      },
      select: { id: true },
    });
    if (!known) await assertCanAddNodes(token.workspaceId, 1);

    const data = {
      hostname: input.hostname,
      os: input.os,
      osVersion: input.osVersion,
      arch: input.arch,
      agentVersion: input.agentVersion,
      secretHash: secret.hash,
      secretPrefix: secret.displayPrefix,
      status: "ACTIVE" as const,
      revokedAt: null,
      enrolledAt: now,
      lastIp: meta.ip,
    };
    const agent = await tx.agent.upsert({
      where: {
        workspaceId_machineId: { workspaceId: token.workspaceId, machineId: input.machineId },
      },
      create: { ...data, workspaceId: token.workspaceId, machineId: input.machineId },
      update: data,
    });
    await recordAudit(tx, {
      workspaceId: token.workspaceId,
      action: "agent.enrolled",
      actor: { type: "AGENT", id: agent.id, label: input.hostname },
      target: { type: "agent", id: agent.id, label: input.hostname },
      metadata: { enrollmentToken: token.prefix, os: input.os, agentVersion: input.agentVersion },
    });
    return {
      agentId: agent.id,
      agentSecret: secret.value,
      config: agentConfig(agent.reportIntervalSec),
    };
  });
}

/** Resolves an ACTIVE agent from its bearer secret. The workspace comes ONLY from here. */
export async function authenticateAgent(secret: string): Promise<Agent | null> {
  const agent = await systemDb("agent authentication by secret hash").agent.findUnique({
    where: { secretHash: hashSecret(secret) },
  });
  return agent && agent.status === "ACTIVE" ? agent : null;
}

/**
 * Stores the raw observation and upserts the agent's host resource
 * (source AGENT, externalId = agent id). Services, listeners and connections
 * are stored raw only; turning them into suggestions is M6.
 */
export async function ingestReport(
  agent: Agent,
  report: ReportV1,
  meta: { ip: string; bytes: number },
): Promise<AgentConfig> {
  const now = new Date();
  const fromAgent = agentHostMetadata(report);

  let ipsChanged = true;
  await tenantDb({ workspaceId: agent.workspaceId }).$transaction(async (tx) => {
    // Baseline for "what changed" (M7): the previous observation of this agent.
    const previous = await tx.observation.findFirst({
      where: { agentId: agent.id },
      orderBy: { receivedAt: "desc" },
      select: { payload: true },
    });

    await tx.observation.create({
      data: {
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        schemaVersion: report.schemaVersion,
        payload: report as unknown as Prisma.InputJsonValue,
        payloadBytes: meta.bytes,
        processedAt: now,
      },
    });

    const host = await upsertHostResource(tx, agent, report, fromAgent, now);
    const resourceId = host.id;
    ipsChanged = host.ipsChanged;

    const changes = diffObserved(
      previous ? observedState(previous.payload as Parameters<typeof observedState>[0]) : null,
      observedState(report),
    );
    if (changes) {
      await recordAgentChange(tx, agent.workspaceId, agent.id, {
        subjectType: "RESOURCE",
        subjectId: resourceId,
        subjectLabel: report.host.hostname,
        kind: "UPDATED",
        summary: describeObservationDiff(report.host.hostname, changes),
        diff: boundedDiff(changes),
      });
    }
    await upsertConnectionFacts(tx, agent, resourceId, report.connections);

    await tx.agent.update({
      where: { id: agent.id },
      data: {
        resourceId,
        hostname: report.host.hostname,
        osVersion: report.host.osVersion,
        arch: report.host.arch,
        agentVersion: report.agentVersion,
        lastSeenAt: now,
        lastIp: meta.ip,
      },
    });

    // Opportunistic retention: drop this agent's expired raw observations.
    await tx.observation.deleteMany({
      where: {
        agentId: agent.id,
        receivedAt: { lt: new Date(now.getTime() - OBSERVATION_RETENTION_DAYS * 86_400_000) },
      },
    });
  });

  if (report.inventory) await importInventory(agent, report.inventory);
  // Discover → Suggest (M6): resolve endpoints and create/refresh DETECTED relationships.
  // Only this agent's facts, unless the host is new or its addresses changed:
  // then other hosts' connections to it may resolve differently (M15).
  await refreshDetectedRelationships(
    agent.workspaceId,
    { agentId: agent.id },
    { onlyAgentFacts: !ipsChanged },
  );
  // Other hosts of the workspace may have gone quiet (throttled, ADR-016).
  await markStaleHosts(agent.workspaceId);

  return agentConfig(agent.reportIntervalSec);
}

async function upsertHostResource(
  tx: Prisma.TransactionClient,
  agent: Agent,
  report: ReportV1,
  fromAgent: ReturnType<typeof agentHostMetadata>,
  now: Date,
): Promise<{ id: string; ipsChanged: boolean }> {
  const key = {
    workspaceId_source_externalId: {
      workspaceId: agent.workspaceId,
      source: "AGENT" as const,
      externalId: agent.id,
    },
  };
  const existing = await tx.resource.findUnique({ where: key });

  if (!existing) {
    const created = await tx.resource.create({
      data: {
        workspaceId: agent.workspaceId,
        name: report.host.hostname,
        type: "SERVER",
        status: "DISCOVERED",
        source: "AGENT",
        externalId: agent.id,
        sourceRef: `agent:${agent.id}`,
        sourceLabel: `Agent on ${report.host.hostname}`,
        metadata: fromAgent,
        lastSeenAt: now,
      },
    });
    await recordAgentChange(tx, agent.workspaceId, agent.id, {
      subjectType: "RESOURCE",
      subjectId: created.id,
      subjectLabel: created.name,
      kind: "DISCOVERED",
      summary: `Discovered ${created.name} (agent)`,
    });
    return { id: created.id, ipsChanged: true };
  }

  const current = resourceMetadataSchema.safeParse(existing.metadata);
  const merged = mergeHostMetadata(current.success ? current.data : {}, fromAgent);
  const diff = diffResource(
    { ...blank, metadata: existing.metadata },
    { ...blank, metadata: merged },
  );
  await tx.resource.update({
    where: { id: existing.id },
    // Name, type, status, notes… belong to humans once the resource exists.
    data: { metadata: merged, lastSeenAt: now },
  });
  if (existing.status === "STALE") await restoreFromStale(tx, existing, agent.id);
  const before = current.success ? (current.data.ipAddresses ?? []) : [];
  const after = merged.ipAddresses ?? [];
  const ipsChanged = before.length !== after.length || before.some((ip) => !after.includes(ip));
  if (diff.metadata) {
    const ipSummary = describeIpChange(existing.name, before, after);
    await recordAgentChange(tx, agent.workspaceId, agent.id, {
      subjectType: "RESOURCE",
      subjectId: existing.id,
      subjectLabel: existing.name,
      kind: "UPDATED",
      summary: ipSummary ?? `Updated ${existing.name}: host details (agent)`,
      diff: diff as Prisma.InputJsonValue,
    });
  }
  return { id: existing.id, ipsChanged };
}

const blank = {
  name: null,
  type: null,
  environment: null,
  criticality: null,
  status: null,
  description: null,
  notes: null,
  tags: null,
  links: null,
};

/**
 * Agent-side collector output (ADR-018 C) goes through the same importer
 * pipeline as an uploaded export, attributed to the agent. A bad inventory
 * never fails the report: the host data is already stored.
 */
async function importInventory(agent: Agent, inventory: NonNullable<ReportV1["inventory"]>) {
  if (inventory.items.length === 0) return;
  try {
    await runImport(
      { workspaceId: agent.workspaceId, userId: null },
      { text: JSON.stringify(inventory.items), format: inventory.source },
      {
        actorType: "AGENT",
        actorId: agent.id,
        // ADR-021: each collection is a full snapshot of that platform.
        source: {
          ref: `collector:${agent.id}:${inventory.source}`,
          label: `${inventory.source === "proxmox" ? "Proxmox" : inventory.source} via agent on ${agent.hostname}`,
          reconcile: true,
        },
      },
    );
  } catch (error) {
    console.warn(
      `[agent ${agent.id}] ${inventory.source} inventory not imported:`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
