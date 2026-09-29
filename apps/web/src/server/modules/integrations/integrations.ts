// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { retireSource } from "@/server/modules/resources/sources";
import { INTEGRATION_FORMS as INTEGRATION_KIND_FORMS } from "@/lib/integration-forms";
import { PlanLimitError } from "@/server/modules/billing/limits";
import { recordAudit, userActor } from "@/server/modules/audit/audit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { IntegrationKind } from "@/generated/prisma/enums";
import { assertRole, type WorkspaceContext } from "@/server/authz";
import {
  SecretConfigError,
  SecretDecryptError,
  buildKeyring,
  needsRotation,
  openSecret,
  sealSecret,
  type Keyring,
} from "@/server/crypto";
import { systemDb, tenantDb } from "@/server/db";
import { getEnv } from "@/server/env";
import {
  ImportHasErrorsError,
  previewImport,
  runImport,
  type ImportResult,
} from "@/server/modules/importers/importers";
import { BlockedDestinationError, safeFetch } from "@/server/safe-fetch";
import { IntegrationError, PROVIDERS, type ProviderDeps } from "./providers";

const defaultDeps: ProviderDeps = { http: safeFetch };

const INTEGRATION_KIND_LABEL = Object.fromEntries(
  Object.entries(INTEGRATION_KIND_FORMS).map(([k, v]) => [k, v.label]),
) as Record<keyof typeof INTEGRATION_KIND_FORMS, string>;

export class IntegrationNotFoundError extends Error {
  constructor() {
    super("Integration not found");
    this.name = "IntegrationNotFoundError";
  }
}

export function integrationsEnabled(): boolean {
  return Boolean(getEnv().CREDENTIALS_ENCRYPTION_KEY);
}

function keyring(): Keyring {
  const env = getEnv();
  return buildKeyring({
    key: env.CREDENTIALS_ENCRYPTION_KEY,
    previousKey: env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
    version: env.CREDENTIALS_KEY_VERSION,
  });
}

/** The secret is bound to its owner row: copying it elsewhere breaks decryption. */
const aad = (workspaceId: string, integrationId: string) =>
  `integration:${workspaceId}:${integrationId}`;

export const integrationInputSchema = z.object({
  kind: z.enum(["AZURE", "AWS", "CLOUDFLARE"]),
  name: z.string().trim().min(1, "Name is required").max(64),
  syncIntervalHours: z.coerce.number().int().min(1).max(168).default(6),
  config: z.record(z.string(), z.unknown()).default({}),
  secret: z.record(z.string(), z.unknown()),
});
export type IntegrationInput = z.input<typeof integrationInputSchema>;

function validated(input: IntegrationInput) {
  const parsed = integrationInputSchema.parse(input);
  const provider = PROVIDERS[parsed.kind];
  return {
    ...parsed,
    config: provider.configSchema.parse(parsed.config) as Record<string, unknown>,
    secret: provider.secretSchema.parse(parsed.secret) as Record<string, unknown>,
    provider,
  };
}

export interface IntegrationView {
  id: string;
  kind: IntegrationKind;
  name: string;
  config: Record<string, unknown>;
  secretHint: string | null;
  syncIntervalHours: number;
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
}

const viewSelect = {
  id: true,
  kind: true,
  name: true,
  config: true,
  secretHint: true,
  syncIntervalHours: true,
  lastSyncAt: true,
  lastSyncOk: true,
  lastSyncMessage: true,
} as const;

/** ADMIN+. Never returns secrets (not even ciphertext). */
export async function listIntegrations(ctx: WorkspaceContext): Promise<IntegrationView[]> {
  assertRole(ctx, "ADMIN");
  const rows = await tenantDb(ctx).integration.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: viewSelect,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ ...r, config: (r.config ?? {}) as Record<string, unknown> }));
}

/**
 * Test connection: fetch with the given (unsaved) credentials and preview
 * what an import would do. Nothing is stored.
 */
export async function testIntegration(
  ctx: WorkspaceContext,
  input: IntegrationInput,
  deps = defaultDeps,
) {
  assertRole(ctx, "ADMIN");
  const v = validated(input);
  const exported = await v.provider.fetchExport(v.config as never, v.secret as never, deps);
  return previewImport(ctx, { text: exported.text, format: exported.format });
}

export async function createIntegration(
  ctx: WorkspaceContext,
  input: IntegrationInput,
): Promise<IntegrationView> {
  assertRole(ctx, "ADMIN");
  const v = validated(input);
  const id = randomUUID();
  const sealed = sealSecret(JSON.stringify(v.secret), aad(ctx.workspaceId, id), keyring());
  const row = await tenantDb(ctx).$transaction(async (tx) => {
    const created = await tx.integration.create({
      data: {
        id,
        workspaceId: ctx.workspaceId,
        kind: v.kind,
        name: v.name,
        config: v.config as never,
        syncIntervalHours: v.syncIntervalHours,
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        secretKeyVersion: sealed.keyVersion,
        secretHint: v.provider.hint(v.secret as never) || null,
        createdById: ctx.userId,
      },
      select: viewSelect,
    });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "integration.created",
      actor: userActor(ctx),
      target: { type: "integration", id, label: v.name },
      metadata: { kind: v.kind, secretHint: created.secretHint },
    });
    return created;
  });
  return { ...row, config: row.config as Record<string, unknown> };
}

/**
 * Deletes the integration and its sealed credential. With `retire`, also
 * retires what it created (ADR-021: untouched → deleted, touched → archived).
 */
export async function deleteIntegration(
  ctx: WorkspaceContext,
  id: string,
  options: { retire?: boolean } = {},
): Promise<{ deleted: number; archived: number } | null> {
  assertRole(ctx, "ADMIN");
  await tenantDb(ctx).$transaction(async (tx) => {
    const row = await tx.integration.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      select: { id: true, name: true, kind: true },
    });
    if (!row) throw new IntegrationNotFoundError();
    await tx.integration.delete({ where: { id: row.id } });
    await recordAudit(tx, {
      workspaceId: ctx.workspaceId,
      action: "integration.deleted",
      actor: userActor(ctx),
      target: { type: "integration", id: row.id, label: row.name },
      metadata: { kind: row.kind },
    });
  });
  return options.retire ? retireSource(ctx, `integration:${id}`) : null;
}

export interface SyncOutcome {
  ok: boolean;
  message: string;
  result?: ImportResult;
}

/**
 * Fetch → import (runImport, actor "integration:<name>") → record outcome.
 * Never throws for provider/import problems; they are stored on the row.
 */
async function syncRow(
  workspaceId: string,
  id: string,
  userId: string | null,
  deps: ProviderDeps,
): Promise<SyncOutcome> {
  const db = tenantDb({ workspaceId, userId });
  const row = await db.integration.findFirst({ where: { id, workspaceId } });
  if (!row) throw new IntegrationNotFoundError();
  const provider = PROVIDERS[row.kind];
  let outcome: SyncOutcome;
  try {
    const ring = keyring();
    const sealed = {
      ciphertext: row.secretCiphertext,
      iv: row.secretIv,
      keyVersion: row.secretKeyVersion,
    };
    const secret = JSON.parse(openSecret(sealed, aad(workspaceId, id), ring));
    if (needsRotation(sealed, ring)) {
      const fresh = sealSecret(JSON.stringify(secret), aad(workspaceId, id), ring);
      await db.integration.update({
        where: { id },
        data: {
          secretCiphertext: fresh.ciphertext,
          secretIv: fresh.iv,
          secretKeyVersion: fresh.keyVersion,
        },
      });
    }
    const exported = await provider.fetchExport(
      provider.configSchema.parse(row.config) as never,
      provider.secretSchema.parse(secret) as never,
      deps,
    );
    const result = await runImport(
      { workspaceId, userId },
      { text: exported.text, format: exported.format },
      {
        actorId: `integration:${row.name}`,
        // ADR-021: a sync is a full snapshot of what this integration sees.
        source: {
          ref: `integration:${row.id}`,
          label: `${INTEGRATION_KIND_LABEL[row.kind]} “${row.name}”`,
          reconcile: true,
        },
      },
    );
    const parts = [
      `${result.created} created`,
      `${result.updated} updated`,
      `${result.unchanged} unchanged`,
      `${result.relationships} relationships`,
      ...(result.staled ? [`${result.staled} no longer reported (stale)`] : []),
      ...(result.restored ? [`${result.restored} reported again`] : []),
    ];
    outcome = {
      ok: true,
      message: parts.join(", ") + (result.reconcileSkipped ? `. ${result.reconcileSkipped}` : ""),
      result,
    };
  } catch (error) {
    outcome = { ok: false, message: safeMessage(error).slice(0, 300) };
  }
  await db.integration.update({
    where: { id },
    data: { lastSyncAt: new Date(), lastSyncOk: outcome.ok, lastSyncMessage: outcome.message },
  });
  return outcome;
}

/** Only messages we wrote are shown to users; anything else is generic (no leakage). */
export function safeMessage(error: unknown): string {
  if (
    error instanceof IntegrationError ||
    error instanceof SecretDecryptError ||
    error instanceof SecretConfigError ||
    error instanceof BlockedDestinationError ||
    error instanceof ImportHasErrorsError ||
    error instanceof PlanLimitError
  ) {
    return error.message;
  }
  if (error instanceof z.ZodError)
    return "Stored configuration is invalid — re-create the integration.";
  if ((error as Error)?.name === "TimeoutError") return "The provider did not answer in time.";
  return "Sync failed (unexpected error).";
}

/** "Sync now" (ADMIN+). */
export async function syncIntegration(
  ctx: WorkspaceContext,
  id: string,
  deps = defaultDeps,
): Promise<SyncOutcome> {
  assertRole(ctx, "ADMIN");
  const outcome = await syncRow(ctx.workspaceId, id, ctx.userId, deps);
  const row = await tenantDb(ctx).integration.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { name: true },
  });
  await recordAudit(tenantDb(ctx), {
    workspaceId: ctx.workspaceId,
    action: "integration.synced",
    actor: userActor(ctx),
    target: { type: "integration", id, label: row?.name },
    metadata: { ok: outcome.ok },
  });
  return outcome;
}

/** Scheduled sync (cron endpoint): every integration whose interval elapsed. */
export async function syncDueIntegrations(now = new Date(), deps = defaultDeps, limit = 20) {
  const candidates = await systemDb("scheduled sync: find due integrations").integration.findMany({
    select: { id: true, workspaceId: true, lastSyncAt: true, syncIntervalHours: true },
    orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } },
  });
  const due = candidates
    .filter(
      (i) =>
        !i.lastSyncAt || now.getTime() - i.lastSyncAt.getTime() >= i.syncIntervalHours * 3_600_000,
    )
    .slice(0, limit);
  let ok = 0;
  let failed = 0;
  for (const i of due) {
    const outcome = await syncRow(i.workspaceId, i.id, null, deps);
    if (outcome.ok) ok++;
    else failed++;
  }
  return { due: due.length, ok, failed };
}
