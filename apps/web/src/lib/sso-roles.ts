// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Directory groups → workspace roles (M33, ADR-048). Pure and client-safe:
 * the Settings form parses and shows the same rules the sign-in applies.
 */
import { z } from "zod";

/** Roles single sign-on may grant. Ownership is never handed out by a directory. */
export const SSO_ROLES = ["VIEWER", "MEMBER", "ADMIN"] as const;
export type SsoRole = (typeof SSO_ROLES)[number];

const RANK: Record<SsoRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2 };

export const groupRoleSchema = z.object({
  group: z.string().trim().min(1).max(256),
  role: z.enum(SSO_ROLES),
});
export type GroupRole = z.infer<typeof groupRoleSchema>;

export const GROUP_RULES_LIMIT = 50;

/**
 * "IT-Admins = ADMIN" per line (also "IT-Admins: admin"); blank lines and
 * lines starting with # ignored. Errors name the line.
 */
export function parseGroupRules(
  text: string,
): { ok: true; rules: GroupRole[] } | { ok: false; error: string } {
  const rules: GroupRole[] = [];
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(.+?)\s*[=:]\s*(viewer|member|admin)$/i.exec(line);
    if (!m) return { ok: false, error: `Line ${i + 1}: write "group = viewer | member | admin".` };
    const parsed = groupRoleSchema.safeParse({ group: m[1], role: m[2]!.toUpperCase() });
    if (!parsed.success) return { ok: false, error: `Line ${i + 1}: group name too long.` };
    rules.push(parsed.data);
  }
  if (rules.length > GROUP_RULES_LIMIT)
    return { ok: false, error: `Up to ${GROUP_RULES_LIMIT} rules.` };
  return { ok: true, rules };
}

export function formatGroupRules(rules: readonly GroupRole[]): string {
  return rules.map((r) => `${r.group} = ${r.role.toLowerCase()}`).join("\n");
}

/**
 * Group names from a claim / attribute value: an array, a single string, or
 * a comma-separated string. Distinguished names ("CN=IT-Admins,OU=…") also
 * match by their first RDN value.
 */
export function groupsFrom(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.includes("=")
        ? [value]
        : value.split(",")
      : [];
  const out = new Set<string>();
  for (const g of raw.map((v) => v.trim()).filter(Boolean)) {
    out.add(g);
    const cn = /^cn=([^,]+)/i.exec(g);
    if (cn) out.add(cn[1]!.trim());
    // Keycloak full paths: "/IT/Admins" → also "Admins".
    if (g.startsWith("/")) out.add(g.split("/").pop()!);
  }
  return [...out];
}

/**
 * The role a person gets: the highest role among the rules matching one of
 * their groups (case-insensitive), else the connection's default role, else
 * null — no access.
 */
export function roleFor(
  groups: readonly string[],
  rules: readonly GroupRole[],
  defaultRole: SsoRole | null,
): SsoRole | null {
  const mine = new Set(groups.map((g) => g.toLowerCase()));
  let best: SsoRole | null = null;
  for (const r of rules)
    if (mine.has(r.group.toLowerCase()) && (best === null || RANK[r.role] > RANK[best]))
      best = r.role;
  return best ?? defaultRole;
}

/** Lower-case domain of an email address ("" when malformed). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0
    ? email
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : "";
}
