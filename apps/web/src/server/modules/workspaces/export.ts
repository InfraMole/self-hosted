// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { recordAudit, userActor } from "@/server/modules/audit/audit";

/**
 * Workspace export (M8c — data portability and backup). ADMIN+.
 *
 * `resources` and `relationships` use the JSON importer's shape, so the file
 * can be imported into another workspace (Library › Import). Only CONFIRMED
 * relationships go there; suggestions are listed separately and not
 * re-imported as facts. Never included: agent secrets / hashes, enrollment
 * and invitation tokens, integration credentials (sealed secrets), raw agent
 * observations. The export itself is audited ("workspace.exported").
 */
export const EXPORT_FORMAT = "depmap-workspace-export/1";

type Meta = Partial<Record<"ipAddresses" | "hostname" | "fqdn" | "os" | "version", unknown>>;

export async function exportWorkspace(ctx: WorkspaceContext) {
  assertRole(ctx, "ADMIN");
  const db = tenantDb(ctx);
  const where = { workspaceId: ctx.workspaceId };
  const [
    workspace,
    members,
    resources,
    relationships,
    agents,
    integrations,
    changes,
    audit,
    discoveryRules,
    savedViews,
  ] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true, slug: true, createdAt: true, requireTwoFactor: true },
    }),
    db.membership.findMany({
      where,
      select: { role: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
    db.resource.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.relationship.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.agent.findMany({
      where,
      select: {
        hostname: true,
        os: true,
        osVersion: true,
        arch: true,
        agentVersion: true,
        status: true,
        enrolledAt: true,
        lastSeenAt: true,
        resourceId: true,
      },
    }),
    db.integration.findMany({
      where,
      select: {
        kind: true,
        name: true,
        config: true,
        syncIntervalHours: true,
        lastSyncAt: true,
        lastSyncOk: true,
      },
    }),
    db.changeEvent.findMany({ where, orderBy: { occurredAt: "asc" }, take: 20_000 }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        actorType: true,
        actorLabel: true,
        action: true,
        targetType: true,
        targetLabel: true,
        metadata: true,
        ip: true,
      },
    }),
    db.discoveryRule.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        port: true,
        processName: true,
        note: true,
        createdAt: true,
        resource: { select: { name: true } },
      },
    }),
    // Saved map views (M26 phase 3): their state refers to resources by id.
    db.savedView.findMany({
      where,
      orderBy: { name: "asc" },
      select: { name: true, state: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const toImportRow = (r: (typeof resources)[number]) => {
    const meta = (r.metadata ?? {}) as Meta;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      environment: r.environment,
      criticality: r.criticality,
      description: r.description,
      notes: r.notes,
      tags: r.tags,
      ip_addresses: meta.ipAddresses ?? [],
      hostname: meta.hostname,
      fqdn: meta.fqdn,
      os: meta.os,
      version: meta.version,
      // Not read by the importer; kept for completeness.
      status: r.status,
      source: r.source,
      links: r.links,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  };
  const toEdge = (r: (typeof relationships)[number]) => ({
    from: r.fromResourceId,
    type: r.type,
    to: r.toResourceId,
    note: r.note,
    origin: r.origin,
    status: r.status,
    createdAt: r.createdAt,
  });

  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    action: "workspace.exported",
    actor: userActor(ctx),
    target: { type: "workspace", id: ctx.workspaceId, label: ctx.workspaceName },
    metadata: { resources: resources.length, relationships: relationships.length },
  });

  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    workspace,
    members: members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.createdAt })),
    resources: resources.map(toImportRow),
    relationships: relationships.filter((r) => r.status === "CONFIRMED").map(toEdge),
    suggestions: relationships.filter((r) => r.status !== "CONFIRMED").map(toEdge),
    agents,
    integrations: integrations.map((i) => ({ ...i, credentials: "not exported" })),
    discoveryRules: discoveryRules.map(({ resource, ...r }) => ({
      ...r,
      resource: resource?.name ?? null,
    })),
    savedViews,
    changes,
    audit,
  };
}
