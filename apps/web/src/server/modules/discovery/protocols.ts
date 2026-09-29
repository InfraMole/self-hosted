// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Well-known ports → protocol guess (docs/DISCOVERY.md §4). A LABEL on
 * evidence ("Likely protocol: MSSQL") and a suggested type when the human
 * adds context — never treated as truth.
 */
import type { RelationshipType } from "@depmap/graph";

export interface ProtocolGuess {
  name: string;
  suggestedType: RelationshipType;
}

const TABLE: Record<number, ProtocolGuess> = {
  1433: { name: "MSSQL", suggestedType: "USES_DATABASE" },
  1521: { name: "Oracle", suggestedType: "USES_DATABASE" },
  3306: { name: "MySQL/MariaDB", suggestedType: "USES_DATABASE" },
  5432: { name: "PostgreSQL", suggestedType: "USES_DATABASE" },
  27017: { name: "MongoDB", suggestedType: "USES_DATABASE" },
  6379: { name: "Redis", suggestedType: "DEPENDS_ON" },
  11211: { name: "Memcached", suggestedType: "DEPENDS_ON" },
  389: { name: "LDAP", suggestedType: "AUTHENTICATES_WITH" },
  636: { name: "LDAPS", suggestedType: "AUTHENTICATES_WITH" },
  88: { name: "Kerberos", suggestedType: "AUTHENTICATES_WITH" },
  3268: { name: "LDAP (Global Catalog)", suggestedType: "AUTHENTICATES_WITH" },
  445: { name: "SMB", suggestedType: "STORES_DATA_IN" },
  2049: { name: "NFS", suggestedType: "STORES_DATA_IN" },
  80: { name: "HTTP", suggestedType: "CALLS" },
  443: { name: "HTTPS", suggestedType: "CALLS" },
  8080: { name: "HTTP (alt)", suggestedType: "CALLS" },
  8443: { name: "HTTPS (alt)", suggestedType: "CALLS" },
  5672: { name: "AMQP", suggestedType: "DEPENDS_ON" },
  9092: { name: "Kafka", suggestedType: "DEPENDS_ON" },
  53: { name: "DNS", suggestedType: "DEPENDS_ON" },
  25: { name: "SMTP", suggestedType: "DEPENDS_ON" },
  587: { name: "SMTP (submission)", suggestedType: "DEPENDS_ON" },
};

export function guessProtocol(port: number): ProtocolGuess | null {
  return TABLE[port] ?? null;
}

/** Suggested relationship type for a set of server-side ports: the lowest recognised one. */
export function suggestedTypeForPorts(ports: readonly number[]): RelationshipType | null {
  const sorted = [...new Set(ports)].sort((a, b) => a - b);
  for (const p of sorted) {
    const guess = guessProtocol(p);
    if (guess) return guess.suggestedType;
  }
  return null;
}
