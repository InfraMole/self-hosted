// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan a change (M34, ADR-050): several resources changing together and what
 * could be affected. Pure and client-safe — the page, the map and the API
 * share these helpers. A plan is never stored: it lives in its URL.
 */
import { CHANGE_LIMIT, type Confidence } from "@depmap/graph";
import { notifyList, type NotifyInput } from "./notify";

const RESOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Resource ids from `?ids=a,b` / `?impact=a,b` (or repeated params): valid, unique, capped. */
export function parseResourceIds(value: string | string[] | undefined | null): string[] {
  const raw = (Array.isArray(value) ? value : value ? [value] : []).flatMap((v) => v.split(","));
  const ids = raw.map((v) => v.trim()).filter((v) => RESOURCE_ID.test(v));
  return [...new Set(ids)].slice(0, CHANGE_LIMIT);
}

/** Free text from the URL (title, when): trimmed, single line, bounded. */
export function planText(value: string | string[] | undefined | null, max: number): string {
  const v = Array.isArray(value) ? value[0] : value;
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export const PLAN_TITLE_MAX = 120;
export const PLAN_WHEN_MAX = 80;

/** "SQL01", "SQL01 and APP02", "SQL01, APP02 and 3 more". */
export function rootsLabel(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** The plan's address: `/w/<slug>/plan?ids=…&title=…&when=…`. */
export function planHref(
  slug: string,
  plan: { ids: readonly string[]; title?: string; when?: string; depth?: number },
): string {
  const q = new URLSearchParams();
  if (plan.ids.length) q.set("ids", plan.ids.join(","));
  if (plan.title) q.set("title", plan.title);
  if (plan.when) q.set("when", plan.when);
  if (plan.depth) q.set("depth", String(plan.depth));
  const query = q.toString();
  return `/w/${slug}/plan${query ? `?${query}` : ""}`;
}

export interface PlanResource {
  name: string;
  typeLabel: string;
  owner: string | null;
  ownerContact: string | null;
}

export interface PlanAffected extends PlanResource {
  confidence: Confidence;
  depth: number;
  /** Changed resources that reach it. */
  causes: string[];
  /** Names along the strongest path, changed resource first. */
  pathNames: string[];
}

export interface PlanReport {
  workspace: string;
  title: string;
  when: string;
  generatedAt: Date;
  changed: PlanResource[];
  affected: PlanAffected[];
}

/**
 * Who to warn: the owners of what changes and of what could be affected,
 * grouped by owner (same rules as the impact page).
 */
export function planNotify(report: Pick<PlanReport, "changed" | "affected">) {
  const items: NotifyInput[] = [
    ...report.changed.map((r) => ({ name: r.name, owner: r.owner, ownerContact: r.ownerContact })),
    ...report.affected.map((r) => ({
      name: r.name,
      owner: r.owner,
      ownerContact: r.ownerContact,
      confidence: r.confidence,
    })),
  ];
  return notifyList(items);
}

const CONFIDENCE_WORD: Record<Confidence, string> = {
  confirmed: "confirmed",
  detected: "detected, to verify",
  inferred: "inferred, to verify",
};

/** Plain-text report for a change request, a ticket or an email. */
export function planReportText(report: PlanReport): string {
  const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    report.generatedAt,
  );
  const names = report.changed.map((r) => r.name);
  const lines = [
    `Change: ${report.title || `Change to ${rootsLabel(names)}`}`,
    ...(report.when ? [`When: ${report.when}`] : []),
    `Workspace: ${report.workspace}`,
    "",
    "In this change:",
    ...report.changed.map(
      (r) => `- ${r.name} (${r.typeLabel})${r.owner ? ` · owner: ${r.owner}` : ""}`,
    ),
    "",
  ];
  if (!report.affected.length) {
    lines.push(
      "No recorded relationship says that anything else depends on these resources.",
      "That does not prove nothing does.",
    );
  } else {
    lines.push(`Could be affected (${report.affected.length}):`);
    for (const a of report.affected)
      lines.push(
        `- ${a.name} (${a.typeLabel}) — ${a.depth === 1 ? "direct" : `via ${a.pathNames.slice(1, -1).join(" → ")}`}, through ${rootsLabel(a.causes)} · ${CONFIDENCE_WORD[a.confidence]}`,
      );
  }
  const notify = planNotify(report);
  if (notify.groups.length || notify.unowned.length) {
    lines.push("", "Who to warn:");
    for (const g of notify.groups)
      lines.push(
        `- ${g.owner}${g.contact ? ` (${g.contact})` : ""}: ${g.resources.map((r) => r.name).join(", ")}`,
      );
    if (notify.unowned.length) lines.push(`- No owner recorded: ${notify.unowned.join(", ")}`);
  }
  lines.push(
    "",
    "Computed by InfraMole from recorded relationships on " +
      `${day}. Detected and inferred relationships are leads to verify, not confirmed dependencies.`,
  );
  return lines.join("\n");
}
