// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import planning — PURE. Decides, for a parsed batch and the workspace's
 * current resources/relationships, what will be created, updated or left
 * alone. The preview shows exactly this plan; apply re-computes it.
 */
import type { RelationshipType } from "@depmap/graph";
import type { ResourceInput, ResourceMetadata } from "@/server/modules/resources/schemas";
import type { ImportBatch, ImportFormat, ProvidedField, RowError } from "./parse";

export interface ExistingResource {
  id: string;
  name: string;
  type: string;
  source: string;
  externalId: string | null;
  environment: string | null;
  criticality: string | null;
  description: string | null;
  notes: string | null;
  tags: string[];
  metadata: ResourceMetadata;
}

export interface ExistingRelationship {
  from: string;
  to: string;
  type: string;
}

export type ResourceAction = "create" | "update" | "unchanged";

export interface PlannedResource {
  row: number;
  externalId: string;
  name: string;
  type: string;
  action: ResourceAction;
  /** Existing resource matched (by externalId, else by name + type). */
  targetId: string | null;
  matchedBy: "externalId" | "name" | null;
  /** Fields that will change on update. */
  changes: ProvidedField[];
  input: ResourceInput;
  provided: ProvidedField[];
}

export interface PlannedRelationship {
  row: number;
  fromLabel: string;
  toLabel: string;
  type: RelationshipType;
  note: string | null;
  action: "create" | "exists";
  /** Import as an unconfirmed suggestion (config-derived) rather than a fact. */
  suggested: boolean;
  /** Existing id or the externalId of a resource created in this import. */
  from: { id?: string; externalId?: string };
  to: { id?: string; externalId?: string };
}

export interface ImportPlan {
  format: ImportFormat;
  resources: PlannedResource[];
  relationships: PlannedRelationship[];
  errors: RowError[];
  warnings: string[];
  counts: { create: number; update: number; unchanged: number; relationships: number };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Value a provided field would take on the existing resource. */
function currentValue(r: ExistingResource, field: ProvidedField): unknown {
  switch (field) {
    case "type":
    case "environment":
    case "criticality":
    case "description":
    case "notes":
      return r[field];
    case "tags":
      return [...r.tags].sort();
    default:
      return r.metadata[field];
  }
}

function newValue(input: ResourceInput, field: ProvidedField): unknown {
  switch (field) {
    case "type":
    case "environment":
    case "criticality":
    case "description":
    case "notes":
      return input[field];
    case "tags":
      return [...input.tags].sort();
    default:
      return input.metadata[field];
  }
}

export function planImport(
  batch: ImportBatch,
  existing: readonly ExistingResource[],
  existingRelationships: readonly ExistingRelationship[],
): ImportPlan {
  const errors = [...batch.errors];
  const warnings = [...batch.warnings];
  const byExternal = new Map(
    existing.filter((r) => r.externalId).map((r) => [`${r.source}|${r.externalId}`, r]),
  );
  const byNameType = new Map<string, ExistingResource[]>();
  for (const r of existing) {
    const k = `${r.name.toLowerCase()}|${r.type}`;
    byNameType.set(k, [...(byNameType.get(k) ?? []), r]);
  }

  const resources: PlannedResource[] = batch.resources.map((res) => {
    const externalId = `${batch.format}:${res.key}`;
    let target = byExternal.get(`IMPORT|${externalId}`) ?? null;
    let matchedBy: PlannedResource["matchedBy"] = target ? "externalId" : null;
    if (!target) {
      const candidates = byNameType.get(`${res.input.name.toLowerCase()}|${res.input.type}`) ?? [];
      if (candidates.length === 1) {
        target = candidates[0]!;
        matchedBy = "name";
      }
    }
    // A VM/container that runs the agent is already in the Library as the
    // agent's SERVER host: same machine, so match it and keep its type.
    let provided = res.provided;
    if (!target && (res.input.type === "VM" || res.input.type === "CONTAINER")) {
      // By VM name, else by the guest's host name (short form: agents report short names).
      const guestName = res.input.metadata?.hostname?.split(".")[0]?.toLowerCase();
      const agentHosts = (name?: string) =>
        (name ? (byNameType.get(`${name}|SERVER`) ?? []) : []).filter((r) => r.source === "AGENT");
      let hosts = agentHosts(res.input.name.toLowerCase());
      if (hosts.length === 0) hosts = agentHosts(guestName);
      if (hosts.length === 1) {
        target = hosts[0]!;
        matchedBy = "name";
        provided = provided.filter((f) => f !== "type");
      }
    }
    const changes = target
      ? provided.filter((f) => !same(currentValue(target!, f), newValue(res.input, f))).sort()
      : [];
    return {
      row: res.row,
      externalId,
      name: res.input.name,
      type: res.input.type,
      action: !target ? "create" : changes.length ? "update" : "unchanged",
      targetId: target?.id ?? null,
      matchedBy,
      changes,
      input: res.input,
      provided,
    };
  });

  // Resolve relationship endpoints: batch key or name, then existing name.
  const inBatch = new Map<string, PlannedResource>();
  for (const [i, r] of resources.entries()) {
    const key = batch.resources[i]!.key;
    inBatch.set(key.toLowerCase(), r);
    inBatch.set(r.name.toLowerCase(), r);
  }
  const existingByName = new Map<string, ExistingResource[]>();
  for (const r of existing) {
    const k = r.name.toLowerCase();
    existingByName.set(k, [...(existingByName.get(k) ?? []), r]);
  }
  // A domain points to an IP, it does not own it: "ip:" refs resolve to the machine only.
  const byIp = new Map<string, ExistingResource[]>();
  for (const r of existing) {
    if (r.type === "DOMAIN") continue;
    for (const ip of r.metadata.ipAddresses ?? []) {
      byIp.set(ip.toLowerCase(), [...(byIp.get(ip.toLowerCase()) ?? []), r]);
    }
  }
  const byId = new Map(existing.map((r) => [r.id, r]));
  // M25: what runs on each resource (for "endpoint:" references).
  const children = new Map<string, ExistingResource[]>();
  for (const rel of existingRelationships) {
    const child = rel.type === "RUNS_ON" ? byId.get(rel.from) : undefined;
    if (child) children.set(rel.to, [...(children.get(rel.to) ?? []), child]);
  }
  /**
   * "endpoint:<hostId>|<host>|<port>": a reverse-proxy target seen from host
   * <hostId>. Loopback → that host; an IP → its single non-DOMAIN owner; a
   * name → the single resource with that name / host name. Then, if exactly
   * one workload on it publishes the port, that workload.
   */
  const resolveEndpoint = (ref: string): { id: string; label: string } | string => {
    const [hostId = "", target = "", portText = ""] = ref.slice("endpoint:".length).split("|");
    const port = Number(portText);
    const t = target.toLowerCase();
    let owners: ExistingResource[] = [];
    if (t === "localhost" || t === "::1" || t.startsWith("127.") || t === "0.0.0.0") {
      const self = byId.get(hostId);
      owners = self ? [self] : [];
    } else if (/^[\d.]+$/.test(t) || t.includes(":")) {
      owners = byIp.get(t) ?? [];
    } else {
      const short = t.split(".")[0]!;
      owners = existing.filter((r) => {
        if (r.type === "DOMAIN") return false;
        const names = [r.name, r.metadata.hostname, r.metadata.fqdn]
          .filter((n): n is string => !!n)
          .map((n) => n.toLowerCase());
        return names.includes(t) || (!t.includes(".") ? false : names.includes(short));
      });
    }
    if (owners.length !== 1) return `No single resource for ${target}:${port}.`;
    const owner = owners[0]!;
    const onPort = (children.get(owner.id) ?? []).filter((c) =>
      (c.metadata.ports ?? []).includes(port),
    );
    if (onPort.length === 1) return { id: onPort[0]!.id, label: onPort[0]!.name };
    if (owner.id === hostId)
      return `${target}:${port} is on the same server and no workload there publishes port ${port}.`;
    return { id: owner.id, label: owner.name };
  };
  const resolve = (ref: string): { id?: string; externalId?: string; label: string } | string => {
    // "id:<resourceId>": an existing resource of this workspace (agent workloads → their host).
    if (ref.startsWith("id:")) {
      const target = byId.get(ref.slice(3));
      return target ? { id: target.id, label: target.name } : `Unknown resource "${ref}".`;
    }
    if (ref.startsWith("endpoint:")) return resolveEndpoint(ref);
    if (ref.startsWith("ip:")) {
      const owners = byIp.get(ref.slice(3).toLowerCase()) ?? [];
      return owners.length === 1
        ? { id: owners[0]!.id, label: owners[0]!.name }
        : `No single resource owns ${ref.slice(3)}.`;
    }
    const planned = inBatch.get(ref.toLowerCase());
    if (planned) {
      return planned.targetId
        ? { id: planned.targetId, label: planned.name }
        : { externalId: planned.externalId, label: planned.name };
    }
    const matches = existingByName.get(ref.toLowerCase()) ?? [];
    if (matches.length === 1) return { id: matches[0]!.id, label: matches[0]!.name };
    return matches.length > 1
      ? `"${ref}" matches several resources.`
      : `Unknown resource "${ref}".`;
  };
  const existingRels = new Set(existingRelationships.map((r) => `${r.from}|${r.to}|${r.type}`));
  const seenRels = new Set<string>();

  const relationships: PlannedRelationship[] = [];
  for (const rel of batch.relationships) {
    const from = resolve(rel.from);
    const to = resolve(rel.to);
    if (typeof from === "string" || typeof to === "string") {
      const message = typeof from === "string" ? from : (to as string);
      if (rel.optional) warnings.push(`Row ${rel.row}: ${message} Relationship skipped.`);
      else errors.push({ row: rel.row, message });
      continue;
    }
    const key = `${from.id ?? from.externalId}|${to.id ?? to.externalId}|${rel.type}`;
    if (seenRels.has(key)) continue;
    seenRels.add(key);
    if ((from.id ?? from.externalId) === (to.id ?? to.externalId)) {
      if (rel.optional) warnings.push(`Row ${rel.row}: ${to.label} points to itself. Skipped.`);
      else errors.push({ row: rel.row, message: "A resource cannot relate to itself." });
      continue;
    }
    relationships.push({
      row: rel.row,
      fromLabel: from.label,
      toLabel: to.label,
      type: rel.type,
      note: rel.note,
      suggested: rel.suggested ?? false,
      action: from.id && to.id && existingRels.has(key) ? "exists" : "create",
      from: { id: from.id, externalId: from.externalId },
      to: { id: to.id, externalId: to.externalId },
    });
  }

  return {
    format: batch.format,
    resources,
    relationships,
    errors,
    warnings,
    counts: {
      create: resources.filter((r) => r.action === "create").length,
      update: resources.filter((r) => r.action === "update").length,
      unchanged: resources.filter((r) => r.action === "unchanged").length,
      relationships: relationships.filter((r) => r.action === "create").length,
    },
  };
}
