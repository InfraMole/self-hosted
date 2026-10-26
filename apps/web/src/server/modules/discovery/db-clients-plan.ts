// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Database clients → suggestions (M42). Pure: decides, for one database
 * host, which "client uses database" suggestions to create and which
 * relationships gain or refresh DB_SESSION evidence, from the sessions the
 * engine listed. Sessions come and go, so nothing is ever removed here.
 */
import { isExcluded, resolveRemote, type RuleInput } from "./plan";

export interface DatabaseClientInput {
  engine: "mssql";
  instance: string;
  database: string;
  address: string;
  port: number;
  sessions: number;
}

/** Key of a database on a host, as the workloads import names it (ADR-028). */
export const databaseKey = (hostId: string, engine: string, instance: string, database: string) =>
  `${hostId}/${engine}/${instance.toLowerCase()}/${database.toLowerCase()}`;

export interface ClientRelationship {
  id: string;
  from: string;
  to: string;
  status: "CONFIRMED" | "UNCONFIRMED" | "IGNORED";
}

export interface SessionEvidence {
  port: number;
  sessions: number;
}

export interface DbClientsPlan {
  /** New USES_DATABASE suggestions client → database. */
  create: ({ from: string; to: string } & SessionEvidence)[];
  /** Existing relationships client → database that gain or refresh DB_SESSION evidence. */
  refresh: ({ relationshipId: string } & SessionEvidence)[];
}

/**
 * A client is resolved like a connection's remote end: exactly one other
 * resource declares the address. Exclusion rules apply to the port and to
 * the client, the database and its host. An existing relationship between
 * client and database (any type) is reused; an IGNORED one, or one a person
 * described the other way round, is left alone.
 */
export function planDatabaseClients(
  hostId: string,
  clients: readonly DatabaseClientInput[],
  databases: ReadonlyMap<string, string>,
  ipIndex: Map<string, string[]>,
  relationships: readonly ClientRelationship[],
  rules: readonly RuleInput[] = [],
): DbClientsPlan {
  const pairs = new Map<string, { from: string; to: string } & SessionEvidence>();
  for (const c of clients) {
    const to = databases.get(databaseKey(hostId, c.engine, c.instance, c.database));
    if (!to) continue;
    const from = resolveRemote(ipIndex, c.address, hostId);
    if (!from || from === to) continue;
    const evidence = { port: c.port, processName: "", sourceResourceId: from };
    if (
      isExcluded(evidence, to, rules) ||
      isExcluded({ ...evidence, sourceResourceId: hostId }, null, rules)
    )
      continue;
    const key = `${from}|${to}`;
    const pair = pairs.get(key);
    if (pair) pair.sessions += c.sessions;
    else pairs.set(key, { from, to, port: c.port, sessions: c.sessions });
  }

  const plan: DbClientsPlan = { create: [], refresh: [] };
  const rank = { CONFIRMED: 0, UNCONFIRMED: 1, IGNORED: 2 } as const;
  for (const pair of pairs.values()) {
    const forward = relationships
      .filter((r) => r.from === pair.from && r.to === pair.to)
      .sort((a, b) => rank[a.status] - rank[b.status]);
    if (forward.length > 0) {
      if (forward[0]!.status !== "IGNORED")
        plan.refresh.push({
          relationshipId: forward[0]!.id,
          port: pair.port,
          sessions: pair.sessions,
        });
      continue;
    }
    if (relationships.some((r) => r.from === pair.to && r.to === pair.from)) continue;
    plan.create.push(pair);
  }
  return plan;
}
