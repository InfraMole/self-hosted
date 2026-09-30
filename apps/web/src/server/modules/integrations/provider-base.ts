// SPDX-License-Identifier: AGPL-3.0-only
/** Shared provider contract (ADR-018 D). Implementations: providers.ts, cloud-providers.ts. */
import { z } from "zod";
import type { ImportFormat } from "@/server/modules/importers/parse";
import type { SafeFetchOptions, SafeResponse } from "@/server/safe-fetch";

export type Http = (url: string, init?: SafeFetchOptions) => Promise<SafeResponse>;

export interface AwsApi {
  describeInstances(nextToken?: string): Promise<{ Reservations?: unknown[]; NextToken?: string }>;
  describeDbInstances(marker?: string): Promise<{ DBInstances?: unknown[]; Marker?: string }>;
}

export interface ProviderDeps {
  http: Http;
  aws?: (region: string, credentials: { accessKeyId: string; secretAccessKey: string }) => AwsApi;
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface ExportResult {
  format: ImportFormat;
  text: string;
}

export interface Provider<C = unknown, S = unknown> {
  configSchema: z.ZodType<C>;
  secretSchema: z.ZodType<S>;
  /** Last characters of the main secret, for display. */
  hint(secret: S): string;
  fetchExport(config: C, secret: S, deps: ProviderDeps): Promise<ExportResult>;
}

export const uuid = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a GUID");
export const last4 = (s: string) => (s.length >= 8 ? s.slice(-4) : "");

export async function json(res: SafeResponse, what: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new IntegrationError(`${what}: unexpected response (HTTP ${res.status}).`);
  }
}
