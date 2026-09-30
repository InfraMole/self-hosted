// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { z } from "zod";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import { tenantDb } from "@/server/db";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { RULE_TEMPLATES, findRuleTemplate, type RuleTemplate } from "@/lib/rule-templates";
import { refreshDetectedRelationships } from "./discovery";
import { excludedSuggestions, type RuleInput } from "./plan";

/**
 * Discovery exclusion rules (M15, ADR-027): "never suggest traffic on port
 * 9102", "…from process MsMpEng.exe", "…to or from BACKUP01". Criteria are
 * ANDed; a rule needs at least one. MEMBER+ (same as reviewing suggestions),
 * audited. Adding a rule removes the unreviewed suggestions it explains;
 * removing it lets them come back on the same discovery pass.
 */

export const RULES_LIMIT = 100;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const discoveryRuleSchema = z
  .object({
    port: z.coerce
      .number()
      .int("Port must be a whole number")
      .min(1, "Port must be between 1 and 65535")
      .max(65535, "Port must be between 1 and 65535")
      .nullish()
      .transform((v) => v ?? null),
    processName: optionalText(128),
    resourceId: optionalText(64),
    note: optionalText(500),
  })
  .refine((r) => r.port !== null || r.processName !== null || r.resourceId !== null, {
    message: "Choose at least a port, a process or a resource",
    path: ["port"],
  });
export type DiscoveryRuleInput = z.input<typeof discoveryRuleSchema>;

export class DiscoveryRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryRuleError";
  }
}

export interface DiscoveryRuleView {
  id: string;
  port: number | null;
  processName: string | null;
  resource: { id: string; name: string } | null;
  note: string | null;
  createdAt: Date;
}

/** Human description, e.g. "port 9102 · process bpcd.exe · BACKUP01". */
export function describeRule(r: {
  port: number | null;
  processName: string | null;
  resourceName?: string | null;
}): string {
  return [
    r.port !== null ? `port ${r.port}` : null,
    r.processName ? `process ${r.processName}` : null,
    r.resourceName ? `to or from ${r.resourceName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function listDiscoveryRules(ctx: WorkspaceContext): Promise<DiscoveryRuleView[]> {
  const rows = await tenantDb(ctx).discoveryRule.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      port: true,
      processName: true,
      note: true,
      createdAt: true,
      resource: { select: { id: true, name: true } },
    },
  });
  return rows;
}

/** Creates a rule, then re-plans discovery. Returns how many suggestions it removed. */
export async function createDiscoveryRule(
  ctx: WorkspaceContext,
  rawInput: unknown,
): Promise<{ id: string; removed: number }> {
  assertRole(ctx, "MEMBER");
  const input = discoveryRuleSchema.parse(rawInput);
  const db = tenantDb(ctx);
  const rule = await db.$transaction(async (tx) => {
    if ((await tx.discoveryRule.count({ where: { workspaceId: ctx.workspaceId } })) >= RULES_LIMIT)
      throw new DiscoveryRuleError(`A workspace can have up to ${RULES_LIMIT} rules.`);
    let resourceName: string | null = null;
    if (input.resourceId) {
      const resource = await tx.resource.findFirst({
        where: { id: input.resourceId, workspaceId: ctx.workspaceId },
        select: { name: true },
      });
      if (!resource)
        throw new DiscoveryRuleError("That resource does not exist in this workspace.");
      resourceName = resource.name;
    }
    const created = await tx.discoveryRule.create({
      data: { ...input, workspaceId: ctx.workspaceId, createdById: ctx.userId },
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "discovery.rule_created",
      actor: userActor(ctx),
      target: {
        type: "discovery_rule",
        id: created.id,
        label: describeRule({ ...input, resourceName }),
      },
    });
    return created;
  });
  const { removed } = await refreshDetectedRelationships(ctx.workspaceId, { userId: ctx.userId });
  return { id: rule.id, removed };
}

export async function deleteDiscoveryRule(ctx: WorkspaceContext, id: string): Promise<void> {
  assertRole(ctx, "MEMBER");
  if (!id || id.length > 64) throw new DiscoveryRuleError("Rule not found.");
  await tenantDb(ctx).$transaction(async (tx) => {
    const rule = await tx.discoveryRule.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      select: { id: true, port: true, processName: true, resource: { select: { name: true } } },
    });
    if (!rule) throw new DiscoveryRuleError("Rule not found.");
    await tx.discoveryRule.delete({ where: { id: rule.id } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "discovery.rule_deleted",
      actor: userActor(ctx),
      target: {
        type: "discovery_rule",
        id: rule.id,
        label: describeRule({ ...rule, resourceName: rule.resource?.name }),
      },
    });
  });
  // Traffic the rule hid can become suggestions again right away.
  await refreshDetectedRelationships(ctx.workspaceId, { userId: ctx.userId });
}

/** Resources a rule can name (non-archived), alphabetically. */
export async function listRuleResourceOptions(
  ctx: WorkspaceContext,
): Promise<{ id: string; name: string }[]> {
  return tenantDb(ctx).resource.findMany({
    where: { workspaceId: ctx.workspaceId, status: { not: "ARCHIVED" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 5000,
  });
}

// ───────────────────────── Suggested rules (M19) ─────────────────────────

export interface RuleTemplateView extends RuleTemplate {
  /** Every rule of the template already exists in this workspace. */
  added: boolean;
  /** Suggestions waiting for review that it would remove now. */
  matches: number;
}

const ruleKey = (r: { port?: number | null; processName?: string | null }) =>
  `${r.port ?? ""}|${(r.processName ?? "").toLowerCase()}`;

const asRuleInputs = (t: RuleTemplate): RuleInput[] =>
  t.rules.map((r, i) => ({
    id: `${t.id}-${i}`,
    port: r.port ?? null,
    processName: r.processName ?? null,
    resourceId: null,
  }));

/** The catalogue, with what each entry would do in this workspace right now. */
export async function listRuleTemplates(ctx: WorkspaceContext): Promise<RuleTemplateView[]> {
  const db = tenantDb(ctx);
  const [rules, suggestions] = await Promise.all([
    db.discoveryRule.findMany({
      where: { workspaceId: ctx.workspaceId, resourceId: null },
      select: { port: true, processName: true },
    }),
    db.relationship.findMany({
      where: { workspaceId: ctx.workspaceId, status: "UNCONFIRMED", evidence: { some: {} } },
      select: {
        id: true,
        fromResourceId: true,
        toResourceId: true,
        evidence: { select: { port: true, processName: true } },
      },
    }),
  ]);
  const existing = new Set(rules.map(ruleKey));
  const inputs = suggestions.map((r) => ({
    relationshipId: r.id,
    from: r.fromResourceId,
    to: r.toResourceId,
    evidence: r.evidence,
  }));
  return RULE_TEMPLATES.map((t) => ({
    ...t,
    added: t.rules.every((r) => existing.has(ruleKey(r))),
    matches: excludedSuggestions(inputs, asRuleInputs(t)).length,
  }));
}

/**
 * Adds the rules of one catalogue entry that the workspace does not have yet
 * (each audited like a hand-made rule), then re-plans discovery once.
 */
export async function applyRuleTemplate(
  ctx: WorkspaceContext,
  templateId: string,
): Promise<{ added: number; removed: number }> {
  assertRole(ctx, "MEMBER");
  const template = findRuleTemplate(templateId);
  if (!template) throw new DiscoveryRuleError("Unknown suggested rule.");
  const added = await tenantDb(ctx).$transaction(async (tx) => {
    const current = await tx.discoveryRule.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { port: true, processName: true, resourceId: true },
    });
    const have = new Set(current.filter((r) => r.resourceId === null).map(ruleKey));
    const missing = template.rules.filter((r) => !have.has(ruleKey(r)));
    if (current.length + missing.length > RULES_LIMIT)
      throw new DiscoveryRuleError(`A workspace can have up to ${RULES_LIMIT} rules.`);
    for (const r of missing) {
      const created = await tx.discoveryRule.create({
        data: {
          workspaceId: ctx.workspaceId,
          port: r.port ?? null,
          processName: r.processName ?? null,
          note: template.name,
          createdById: ctx.userId,
        },
      });
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        action: "discovery.rule_created",
        actor: userActor(ctx),
        target: {
          type: "discovery_rule",
          id: created.id,
          label: describeRule({ port: created.port, processName: created.processName }),
        },
        metadata: { template: template.id },
      });
    }
    return missing.length;
  });
  const { removed } =
    added > 0
      ? await refreshDetectedRelationships(ctx.workspaceId, { userId: ctx.userId })
      : { removed: 0 };
  return { added, removed };
}
