// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Importers (M8) — PURE parsing of CSV / JSON / Docker Compose into one
 * normalised batch (docs/DISCOVERY.md §2, ADR-011). No DB access here.
 */
import { parse as parseYaml } from "yaml";
import { RELATIONSHIP_TYPES, RELATIONSHIP_TYPE_INFO, type RelationshipType } from "@depmap/graph";
import { Environment, Criticality, ResourceType } from "@/generated/prisma/enums";
import { detectPlatform, parsePlatform, type PlatformFormat } from "./parse-platforms";
import {
  fieldErrors,
  resourceInputSchema,
  type ResourceInput,
} from "@/server/modules/resources/schemas";

export type ImportFormat =
  | "csv"
  | "json"
  | "docker-compose"
  | "proxmox"
  | "azure"
  | "aws"
  | "cloudflare"
  | "workloads"
  | "cloud"
  | "hypervisor"
  | "kubernetes"
  | "tailscale"
  | "storage";

export const IMPORT_LIMITS = { bytes: 1024 * 1024, resources: 2000, relationships: 5000 } as const;

/** Fields a row actually provided — updates only touch these. */
export type ProvidedField =
  | "type"
  | "environment"
  | "criticality"
  | "description"
  | "notes"
  | "owner"
  | "ownerContact"
  | "tags"
  | "hostname"
  | "fqdn"
  | "os"
  | "version"
  | "ipAddresses"
  | "ports";

export interface ImportResource {
  row: number;
  /** Stable key within the source (becomes externalId "<format>:<key>"). */
  key: string;
  input: ResourceInput;
  provided: ProvidedField[];
  /**
   * Enrichment (Tailscale, M27): match an existing machine (SERVER / VM) by
   * name or host name whatever its type, and only ADD this row's IPs and tags
   * to it. Without a match, created only when `create` is true; otherwise
   * skipped with a warning.
   */
  enrich?: { create: boolean };
}

export interface ImportRelationship {
  row: number;
  /** Resource reference: key (id column) or name, case-insensitive. */
  from: string;
  to: string;
  type: RelationshipType;
  note: string | null;
  /** True when inferred from configuration: imported as a suggestion to review. */
  suggested?: boolean;
  /** Unresolvable endpoints become warnings instead of errors (e.g. "ip:…" refs). */
  optional?: boolean;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ImportBatch {
  format: ImportFormat;
  resources: ImportResource[];
  relationships: ImportRelationship[];
  errors: RowError[];
  warnings: string[];
}

// ───────────────────────── format detection ─────────────────────────

export function detectFormat(text: string): ImportFormat {
  const t = text.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (/^\s*services\s*:/m.test(text)) return "docker-compose";
  return "csv";
}

export function parseImport(
  text: string,
  format: ImportFormat,
  options: { project?: string } = {},
): ImportBatch {
  if (new TextEncoder().encode(text).length > IMPORT_LIMITS.bytes) {
    return empty(format, [{ row: 0, message: "Input is larger than 1 MB." }]);
  }
  const batch =
    format === "json" ||
    format === "proxmox" ||
    format === "azure" ||
    format === "aws" ||
    format === "cloudflare" ||
    format === "workloads" ||
    format === "cloud" ||
    format === "hypervisor" ||
    format === "kubernetes" ||
    format === "tailscale" ||
    format === "storage"
      ? parseJsonOrPlatform(text, format)
      : format === "csv"
        ? parseCsvImport(text)
        : parseCompose(text, options.project);
  if (batch.resources.length > IMPORT_LIMITS.resources) {
    batch.errors.push({
      row: 0,
      message: `At most ${IMPORT_LIMITS.resources} resources per import.`,
    });
  }
  if (batch.relationships.length > IMPORT_LIMITS.relationships) {
    batch.errors.push({
      row: 0,
      message: `At most ${IMPORT_LIMITS.relationships} relationships per import.`,
    });
  }
  checkDuplicateKeys(batch);
  return batch;
}

const empty = (format: ImportFormat, errors: RowError[] = []): ImportBatch => ({
  format,
  resources: [],
  relationships: [],
  errors,
  warnings: [],
});

// ───────────────────────── value normalisation ─────────────────────────

const norm = (v: string) =>
  v
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const ENV_ALIASES: Record<string, Environment> = {
  PROD: "PRODUCTION",
  PRD: "PRODUCTION",
  STG: "STAGING",
  STAGE: "STAGING",
  PREPROD: "STAGING",
  DEV: "DEVELOPMENT",
  QA: "TEST",
  TESTING: "TEST",
};
const TYPE_ALIASES: Record<string, ResourceType> = {
  HOST: "SERVER",
  VIRTUAL_MACHINE: "VM",
  APP: "APPLICATION",
  SERVICE: "APPLICATION",
  DB: "DATABASE",
  SAAS: "EXTERNAL_SERVICE",
  EXTERNAL: "EXTERNAL_SERVICE",
};

function enumValue<T extends string>(
  values: Record<string, T>,
  aliases: Record<string, T>,
  raw: unknown,
): T | string | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const key = norm(String(raw));
  return (Object.values(values) as string[]).includes(key)
    ? (key as T)
    : (aliases[key] ?? String(raw));
}

export function relationshipTypeFrom(raw: unknown): RelationshipType | null {
  if (raw === undefined || raw === null) return null;
  const key = norm(String(raw));
  if ((RELATIONSHIP_TYPES as readonly string[]).includes(key)) return key as RelationshipType;
  const label = String(raw).trim().toLowerCase();
  return RELATIONSHIP_TYPES.find((t) => RELATIONSHIP_TYPE_INFO[t].label === label) ?? null;
}

const list = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    : typeof raw === "string"
      ? raw
          .split(/[;,|\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

const text = (raw: unknown): string | null =>
  raw === undefined || raw === null || String(raw).trim() === "" ? null : String(raw).trim();

/** Builds + validates one resource row from loosely-named fields. */
export function buildResourceRow(
  row: number,
  fields: Record<string, unknown>,
  keyPrefix = "",
): ImportResource | RowError {
  const get = (...names: string[]) => {
    for (const n of names) if (fields[n] !== undefined && fields[n] !== "") return fields[n];
    return undefined;
  };
  const name = text(get("name"));
  if (!name) return { row, message: "Missing name." };
  const provided: ProvidedField[] = [];
  const mark = <T>(field: ProvidedField, value: T): T => {
    if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
      provided.push(field);
    return value;
  };
  const metadata: Record<string, unknown> = {};
  for (const [field, names] of [
    ["hostname", ["hostname", "host"]],
    ["fqdn", ["fqdn"]],
    ["os", ["os", "platform"]],
    ["version", ["version"]],
  ] as const) {
    const v = text(get(...names));
    if (v) metadata[field] = mark(field, v);
  }
  const ips = list(get("ipaddresses", "ip_addresses", "ips", "ip"));
  if (ips.length) metadata.ipAddresses = mark("ipAddresses", ips);
  const ports = get("ports");
  if (Array.isArray(ports) && ports.length) metadata.ports = mark("ports", ports);

  const typeRaw = get("type");
  const candidate = {
    name,
    type: typeRaw === undefined ? "OTHER" : enumValue(ResourceType, TYPE_ALIASES, typeRaw),
    environment: mark(
      "environment",
      enumValue(Environment, ENV_ALIASES, get("environment", "env")),
    ),
    criticality: mark("criticality", enumValue(Criticality, {}, get("criticality"))),
    description: mark("description", text(get("description"))),
    notes: mark("notes", text(get("notes"))),
    owner: mark("owner", text(get("owner"))),
    ownerContact: mark("ownerContact", text(get("owner_contact", "ownercontact", "contact"))),
    tags: mark(
      "tags",
      list(get("tags")).map((t) => t.toLowerCase()),
    ),
    links: [],
    metadata,
  };
  if (typeRaw !== undefined) provided.push("type");
  const parsed = resourceInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const errs = fieldErrors(parsed.error);
    return {
      row,
      message: Object.entries(errs)
        .map(([f, m]) => `${f}: ${m}`)
        .join("; "),
    };
  }
  const key = (text(get("id", "key", "externalid")) ?? name).toLowerCase();
  return { row, key: keyPrefix + key, input: parsed.data, provided };
}

function relationshipRow(
  row: number,
  fields: Record<string, unknown>,
): ImportRelationship | RowError {
  const from = text(fields.from ?? fields.source);
  const to = text(fields.to ?? fields.target);
  if (!from || !to) return { row, message: "Relationship needs 'from' and 'to'." };
  const type = relationshipTypeFrom(fields.type ?? fields.relationship);
  if (!type) return { row, message: `Unknown relationship type "${String(fields.type ?? "")}".` };
  if (from.toLowerCase() === to.toLowerCase())
    return { row, message: "A resource cannot relate to itself." };
  const note = text(fields.note);
  return { row, from, to, type, note: note ? note.slice(0, 1000) : null };
}

function push(batch: ImportBatch, item: ImportResource | ImportRelationship | RowError) {
  if ("message" in item) batch.errors.push(item);
  else if ("input" in item) batch.resources.push(item);
  else batch.relationships.push(item);
}

function checkDuplicateKeys(batch: ImportBatch) {
  const seen = new Map<string, number>();
  for (const r of batch.resources) {
    const prev = seen.get(r.key);
    if (prev !== undefined)
      batch.errors.push({ row: r.row, message: `Duplicate of row ${prev} ("${r.input.name}").` });
    else seen.set(r.key, r.row);
  }
}

// ───────────────────────── JSON ─────────────────────────

/** Generic JSON, or a platform export (Proxmox / Azure / AWS) detected from its shape. */
function parseJsonOrPlatform(input: string, format: ImportFormat): ImportBatch {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch (e) {
    return empty(format, [{ row: 0, message: `Invalid JSON: ${(e as Error).message}` }]);
  }
  const platform = format === "json" ? detectPlatform(data) : (format as PlatformFormat);
  return platform ? parsePlatform(platform, data) : parseJsonData(data);
}

/** `{ resources: [...], relationships: [...] }` or a bare array of resources. */
export function parseJsonImport(input: string): ImportBatch {
  return parseJsonOrPlatform(input, "json");
}

function parseJsonData(data: unknown): ImportBatch {
  const batch = empty("json");
  const obj = Array.isArray(data) ? { resources: data } : (data as Record<string, unknown>);
  const resources = Array.isArray(obj?.resources) ? obj.resources : [];
  const relationships = Array.isArray(obj?.relationships) ? obj.relationships : [];
  if (!resources.length && !relationships.length) {
    batch.errors.push({
      row: 0,
      message: 'Expected { "resources": [...], "relationships": [...] }.',
    });
  }
  resources.forEach((r, i) => push(batch, buildResourceRow(i + 1, lowerKeys(r))));
  relationships.forEach((r, i) => push(batch, relationshipRow(i + 1, lowerKeys(r))));
  return batch;
}

function lowerKeys(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k.toLowerCase().replace(/[\s-]/g, "_"), v]),
  );
}

// ───────────────────────── CSV ─────────────────────────

/** RFC 4180-ish: quoted fields, escaped quotes, newlines inside quotes, , or ; separator. */
export function parseCsv(input: string): string[][] {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Resources CSV (has `name`) or relationships CSV (has `from`,`to`,`type`). */
export function parseCsvImport(input: string): ImportBatch {
  const batch = empty("csv");
  const rows = parseCsv(input.replace(/^﻿/, ""));
  if (rows.length < 2) {
    batch.errors.push({ row: 0, message: "CSV needs a header row and at least one data row." });
    return batch;
  }
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]/g, "_"));
  const isRelationships = header.includes("from") && header.includes("to");
  if (!isRelationships && !header.includes("name")) {
    batch.errors.push({
      row: 1,
      message: "Header must include 'name' (resources) or 'from,type,to' (relationships).",
    });
    return batch;
  }
  rows.slice(1).forEach((cells, i) => {
    const fields = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
    push(batch, isRelationships ? relationshipRow(i + 2, fields) : buildResourceRow(i + 2, fields));
  });
  return batch;
}

// ───────────────────────── Docker Compose ─────────────────────────

interface ComposeService {
  image?: string;
  container_name?: string;
  ports?: unknown[];
  depends_on?: string[] | Record<string, unknown>;
  links?: string[];
  build?: unknown;
}

/**
 * services → CONTAINER resources (key "<project>/<service>"),
 * depends_on / links → DEPENDS_ON relationships (imported as suggestions).
 */
export function parseCompose(input: string, project = "compose"): ImportBatch {
  const batch = empty("docker-compose");
  let doc: { name?: string; services?: Record<string, ComposeService> };
  try {
    doc = parseYaml(input, { maxAliasCount: 50 }) ?? {};
  } catch (e) {
    batch.errors.push({ row: 0, message: `Invalid YAML: ${(e as Error).message.split("\n")[0]}` });
    return batch;
  }
  const services = doc?.services;
  if (!services || typeof services !== "object") {
    batch.errors.push({ row: 0, message: "No 'services:' section found." });
    return batch;
  }
  const projectName = (doc.name ?? project).trim() || "compose";
  const names = Object.keys(services);
  names.forEach((service, i) => {
    const s = services[service] ?? {};
    const ports = (s.ports ?? []).map((p) =>
      typeof p === "object" ? JSON.stringify(p) : String(p),
    );
    const image = s.image ?? (s.build ? "built locally" : undefined);
    const version = s.image?.includes(":") ? s.image.split(":").pop() : undefined;
    push(
      batch,
      buildResourceRow(i + 1, {
        id: `${projectName}/${service}`,
        name: s.container_name ?? service,
        type: "CONTAINER",
        description: [image && `image ${image}`, ports.length && `ports ${ports.join(", ")}`]
          .filter(Boolean)
          .join(" · "),
        tags: ["compose", projectName.toLowerCase().replace(/[^a-z0-9._:-]/g, "-")],
        version,
      }),
    );
    const deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on ?? {});
    const links = (s.links ?? []).map((l) => String(l).split(":")[0]!);
    for (const dep of new Set([...deps, ...links])) {
      if (!names.includes(dep)) {
        batch.warnings.push(`${service}: depends on unknown service "${dep}".`);
        continue;
      }
      batch.relationships.push({
        row: i + 1,
        from: `${projectName}/${service}`.toLowerCase(),
        to: `${projectName}/${dep}`.toLowerCase(),
        type: "DEPENDS_ON",
        note: `Inferred from docker-compose: ${service} depends_on ${dep}`,
        suggested: true,
      });
    }
  });
  return batch;
}
